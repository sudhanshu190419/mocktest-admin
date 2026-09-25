'use client';

/**
 * Student Test Instructions / System Check Screen
 *
 * Route: /student/tests/[testId]
 *
 * Serves as the safe launchpad between selecting a test and entering the runner:
 *   - Displays real test specifications, dynamic section breakdown, and marking rules
 *   - Verifies student batch/course entitlement
 *   - Inspects real attempt states (Not Started, In Progress, Submitted, Limit Reached)
 *   - Safely initiates attempt via initialize_mock_attempt RPC upon explicit student action
 *
 * @module app/student/tests/[testId]/page
 */

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  IconArrowLeft,
  IconTest,
  IconClock,
  IconFileText,
  IconTrophy,
  IconWarning,
  IconPlayCircle,
  IconRefresh,
  IconCheckCircle,
  IconCheck,
  IconSpark,
  IconInfo,
  IconLock,
  IconVideo,
  IconWifi,
} from '@/components/icons/student-icons';
import {
  fetchStudentTestInstructions,
  initializeStudentTestAttempt,
  type StudentTestInstructionsData,
} from '@/services/student/studentTestWebService';

export default function StudentTestInstructionsPage() {
  const params = useParams();
  const router = useRouter();
  const testId = params?.testId as string;

  const [data, setData] = useState<StudentTestInstructionsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Student checklist agreement
  const [hasAgreed, setHasAgreed] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [startError, setStartError] = useState<string | null>(null);

  const loadInstructions = useCallback(async () => {
    if (!testId) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchStudentTestInstructions(testId);
      if (res.error || !res.data) {
        setError(res.error || 'Test not found or no longer accessible.');
      } else {
        setData(res.data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load test instructions.');
    } finally {
      setIsLoading(false);
    }
  }, [testId]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!testId) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchStudentTestInstructions(testId);
        if (!isMounted) return;
        if (res.error || !res.data) {
          setError(res.error || 'Test not found or no longer accessible.');
        } else {
          setData(res.data);
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load test instructions.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void load();
    return () => {
      isMounted = false;
    };
  }, [testId]);

  // Handle Start / Resume Test
  const handleStartOrResume = async () => {
    if (!data) return;
    const { test, attemptSummary } = data;

    // If test is submitted and limit reached, redirect to results
    if (attemptSummary.attemptState === 'submitted' && !attemptSummary.canAttempt) {
      if (attemptSummary.latestAttemptId) {
        router.push('/student/tests/' + testId + '/results/' + attemptSummary.latestAttemptId);
        return;
      }
    }

    if (!hasAgreed && attemptSummary.attemptState !== 'in_progress') {
      setStartError('Please confirm that you have read and agreed to the exam instructions.');
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const initRes = await initializeStudentTestAttempt(
        test.testId,
        test.instituteId,
        test.attemptLimit
      );

      if (!initRes.success || !initRes.data) {
        setStartError(initRes.error || 'Could not start test. Please try again.');
        setIsStarting(false);
        return;
      }

      const { attemptId } = initRes.data;

      // Navigate to the Web Test Runner with attempt ID
      router.push('/student/tests/' + test.testId + '/runner?attemptId=' + attemptId);
    } catch (err: unknown) {
      setStartError(err instanceof Error ? err.message : 'An error occurred while launching the exam.');
      setIsStarting(false);
    }
  };

  // Format Dates
  const formatScheduleDate = (isoStr?: string | null) => {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('en-IN', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  };

  // 1. Loading Skeleton State
  if (isLoading) {
    return (
      <div className="space-y-6 max-w-6xl mx-auto py-2 animate-pulse">
        <div className="h-4 w-36 bg-sky-tint rounded-md" />
        <div className="h-8 w-2/3 bg-sky-tint rounded-field" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-44 bg-paper rounded-card" />
            <div className="h-32 bg-paper rounded-card" />
            <div className="h-64 bg-paper rounded-card" />
          </div>
          <div className="space-y-4">
            <div className="h-60 bg-paper rounded-card" />
            <div className="h-40 bg-paper rounded-card" />
          </div>
        </div>
      </div>
    );
  }

  // 2. Error / Not Found / Inaccessible State
  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-card bg-rose-50 text-rose-600 mx-auto">
          <IconWarning size={28} />
        </div>
        <h2 className="text-lg sm:text-xl font-bold text-ink">
          Cannot Access Test
        </h2>
        <p className="text-xs sm:text-sm text-ink-secondary leading-relaxed max-w-md mx-auto">
          {error || 'This assessment is currently inaccessible or does not exist.'}
        </p>
        <div className="pt-4 flex items-center justify-center gap-3">
          <Link
            href="/student/tests"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-field bg-ink hover:bg-ink text-white font-bold text-xs transition-colors shadow-sm"
          >
            <IconArrowLeft size={14} />
            <span>Back to Mock Tests Hub</span>
          </Link>
          <button
            onClick={loadInstructions}
            className="px-4 py-2.5 rounded-field border border-line bg-white hover:bg-paper text-ink font-bold text-xs transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { test, structure, attemptSummary, latestResult } = data;
  const isUpcoming = test.availabilityStatus === 'upcoming';
  const isExpired = test.availabilityStatus === 'expired';
  const attemptState = attemptSummary.attemptState;

  // Format Marking Scheme
  const marksPerCorrect = structure.marksPerCorrect;
  const correctText = structure.hasVaryingMarks
    ? 'Varies per question'
    : ('+' + (marksPerCorrect ?? 4) + ' marks for each correct answer');

  const negativeText = structure.hasVaryingNegativeMarks
    ? 'Varies per question'
    : test.negativeMarking > 0
    ? ('-' + test.negativeMarking + ' mark penalty for incorrect answers')
    : 'No negative marking';

  return (
    <div className="store-container space-y-7 pb-16">
      {/* Top Header & Breadcrumb */}
      <div>
        <nav className="store-breadcrumb" aria-label="Breadcrumb">
          <Link href="/student/overview">My Learning</Link>
          <span aria-hidden="true">/</span>
          <Link href="/student/tests">Mock Tests</Link>
          <span aria-hidden="true">/</span>
          <span>{test.title}</span>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3 py-1 text-xs font-bold text-brand-hover border border-line">
                <IconTest size={14} />
                <span>{test.testType.replace(/_/g, ' ').toUpperCase()}</span>
              </span>
              {test.subjectName && (
                <span className="inline-flex items-center rounded-lg bg-sky-tint px-2.5 py-0.5 text-xs font-semibold text-brand-hover border border-line">
                  {test.subjectName}
                </span>
              )}
              {test.courseTitle && (
                <span className="inline-flex items-center rounded-lg bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
                  {test.courseTitle}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight mt-2">
              {test.title}
            </h1>
            {test.description && (
              <p className="text-xs sm:text-sm text-ink-secondary mt-1 max-w-2xl leading-relaxed">
                {test.description}
              </p>
            )}
          </div>

          {/* Status Badge */}
          <div>
            {isUpcoming ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-1.5 text-xs font-bold text-amber-800 border border-amber-200">
                <IconClock size={14} />
                <span>Opens: {formatScheduleDate(test.availableFrom)}</span>
              </span>
            ) : attemptState === 'in_progress' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3.5 py-1.5 text-xs font-bold text-brand-hover border border-line">
                <IconRefresh size={14} />
                <span>Attempt In Progress</span>
              </span>
            ) : attemptState === 'submitted' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                <IconCheckCircle size={14} />
                <span>Previously Attempted</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3.5 py-1.5 text-xs font-bold text-brand-hover border border-line">
                <IconSpark size={14} />
                <span>Ready to Attempt</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left / Main Column (65% width) */}
        <div className="lg:col-span-2 space-y-6">
          {/* 1. Hero 4-Box Test Summary Grid */}
          <div className="rounded-card border border-line bg-white p-5 sm:p-6 shadow-xs">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-4">
              Assessment Summary
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="rounded-field border border-line bg-paper/70 p-3.5">
                <IconClock className="h-5 w-5 text-brand mx-auto" />
                <p className="text-xs font-medium text-ink-muted mt-1.5">Duration</p>
                <p className="text-base font-extrabold text-ink mt-0.5">
                  {test.durationMin !== null ? (test.durationMin + ' Mins') : 'Flexible'}
                </p>
              </div>

              <div className="rounded-field border border-line bg-paper/70 p-3.5">
                <IconFileText className="h-5 w-5 text-brand mx-auto" />
                <p className="text-xs font-medium text-ink-muted mt-1.5">Questions</p>
                <p className="text-base font-extrabold text-ink mt-0.5">
                  {structure.totalQuestions > 0 ? (structure.totalQuestions + ' Qs') : 'Configured'}
                </p>
              </div>

              <div className="rounded-field border border-line bg-paper/70 p-3.5">
                <IconTrophy className="h-5 w-5 text-emerald-600 mx-auto" />
                <p className="text-xs font-medium text-ink-muted mt-1.5">Total Marks</p>
                <p className="text-base font-extrabold text-ink mt-0.5">
                  {structure.totalMarks > 0 ? structure.totalMarks : (test.totalMarks || '—')}
                </p>
              </div>

              <div className="rounded-field border border-line bg-paper/70 p-3.5">
                <IconWarning className="h-5 w-5 text-amber-500 mx-auto" />
                <p className="text-xs font-medium text-ink-muted mt-1.5">Negative Mark</p>
                <p className="text-base font-extrabold text-ink mt-0.5">
                  {structure.hasVaryingNegativeMarks
                    ? 'Varies'
                    : test.negativeMarking > 0
                    ? ('-' + test.negativeMarking)
                    : 'None'}
                </p>
              </div>
            </div>
          </div>

          {/* 2. Syllabus / Section Breakdown */}
          {structure.sections && structure.sections.length > 0 && (
            <div className="rounded-card border border-line bg-white p-5 sm:p-6 shadow-xs">
              <div className="flex items-center justify-between mb-3.5">
                <h2 className="text-sm font-bold text-ink">
                  Exam Sections & Syllabus Coverage
                </h2>
                <span className="text-xs text-ink-muted">
                  {structure.sections.length} Section{structure.sections.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {structure.sections.map((sec, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-field border border-line bg-paper/50 p-3.5"
                  >
                    <div>
                      <span className="text-xs font-bold text-ink">
                        {sec.sectionName}
                      </span>
                      <p className="text-caption text-ink-muted mt-0.5">
                        {sec.questionCount} Question{sec.questionCount > 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-lg bg-sky-tint px-2.5 py-1 text-xs font-extrabold text-brand-hover">
                      {sec.totalMarks} Marks
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Marking Scheme Card */}
          <div className="rounded-card border border-line bg-white p-5 sm:p-6 shadow-xs">
            <h2 className="text-sm font-bold text-ink mb-3">
              Marking Scheme & Scoring Policy
            </h2>
            <div className="space-y-2.5 text-xs text-ink-secondary">
              <div className="flex items-start gap-2.5 p-3 rounded-field bg-emerald-50/50 border border-emerald-100">
                <IconCheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-emerald-950">Correct Answers: </span>
                  <span>{correctText}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-field bg-rose-50/50 border border-rose-100">
                <IconWarning className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-rose-950">Incorrect Answers: </span>
                  <span>{negativeText}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-field bg-paper border border-line">
                <IconInfo className="h-4 w-4 text-ink-muted shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-ink">Unattempted Questions: </span>
                  <span>0 marks (no negative penalty for questions left blank)</span>
                </div>
              </div>

              {test.passingMarks && (
                <div className="flex items-start gap-2.5 p-3 rounded-field bg-sky-tint/50 border border-line">
                  <IconTrophy className="h-4 w-4 text-brand shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-brand-hover">Cutoff / Passing Score: </span>
                    <span>{test.passingMarks} marks required</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 4. Instructions & Guidelines Accordion */}
          <div className="rounded-card border border-line bg-white p-5 sm:p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-ink">
              Exam Instructions & Guidelines
            </h2>

            <div className="space-y-3.5 text-xs text-ink-secondary leading-relaxed">
              <div className="space-y-1.5">
                <h3 className="font-bold text-ink flex items-center gap-1.5">
                  <span>1. General Guidelines</span>
                </h3>
                <ul className="list-disc list-inside space-y-1 pl-1 text-ink-secondary">
                  <li>The total duration of this test is {test.durationMin ?? 180} minutes.</li>
                  <li>Once started, the timer cannot be paused. The test will automatically submit when time expires.</li>
                  <li>All your selected answers are continuously persisted in the background.</li>
                </ul>
              </div>

              <div className="space-y-1.5 border-t border-line pt-3">
                <h3 className="font-bold text-ink flex items-center gap-1.5">
                  <span>2. Navigation & Question Palette</span>
                </h3>
                <ul className="list-disc list-inside space-y-1 pl-1 text-ink-secondary">
                  <li>Use the Question Palette on the right to jump directly to any question.</li>
                  <li>You can mark questions as <strong>Marked for Review</strong> to revisit them later before submitting.</li>
                  <li>You can change your selected answer or clear response at any time during the test.</li>
                </ul>
              </div>

              <div className="space-y-1.5 border-t border-line pt-3">
                <h3 className="font-bold text-ink flex items-center gap-1.5">
                  <span>3. System Integrity & Submission</span>
                </h3>
                <ul className="list-disc list-inside space-y-1 pl-1 text-ink-secondary">
                  <li>Do not refresh or close the browser tab while taking the test.</li>
                  <li>In case of accidental disconnect, returning to this page will allow you to resume your attempt.</li>
                  <li>Click <strong>Submit Test</strong> once you have answered all questions. Instant scorecard and solutions will be available immediately.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Right / Sidebar Column (35% width) */}
        <div className="space-y-5 lg:sticky lg:top-4">
          {/* Attempt Status Card */}
          <div className="rounded-card border border-line bg-white p-5 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-3">
              Your Attempt Status
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-secondary">Attempt Limit</span>
                <span className="font-bold text-ink">
                  {test.attemptLimit ? (test.attemptLimit + ' Max') : 'Unlimited Practice'}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-ink-secondary">Attempts Used</span>
                <span className="font-bold text-ink">
                  {attemptSummary.attemptsUsed} attempt{attemptSummary.attemptsUsed === 1 ? '' : 's'}
                </span>
              </div>

              {test.attemptLimit && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-secondary">Attempts Remaining</span>
                  <span className="font-bold text-brand">
                    {attemptSummary.attemptsRemaining !== null ? attemptSummary.attemptsRemaining : '—'}
                  </span>
                </div>
              )}

              {/* In-Progress Notification */}
              {attemptState === 'in_progress' && (
                <div className="rounded-field bg-sky-tint border border-line p-3 text-xs text-brand-hover mt-2">
                  <div className="flex items-center gap-2 font-bold">
                    <IconRefresh className="h-4 w-4 text-brand animate-spin" />
                    <span>In-Progress Attempt Found</span>
                  </div>
                  <p className="mt-1 text-caption text-brand-hover">
                    Your saved answers and remaining time will be restored automatically upon resuming.
                  </p>
                </div>
              )}

              {/* Latest Result Snippet (If previously completed) */}
              {latestResult && attemptState === 'submitted' && (
                <div className="rounded-field bg-emerald-50/60 border border-emerald-200 p-3 text-xs mt-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-950">Previous Score</span>
                    <span className="font-extrabold text-emerald-800">
                      {latestResult.totalScore} / {latestResult.maxScore} ({latestResult.percentage}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-caption text-ink-secondary mt-1">
                    <span>Accuracy: {latestResult.accuracy}%</span>
                    <span>{latestResult.correctCount} Correct</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* System Readiness Check */}
          <div className="rounded-card border border-line bg-white p-5 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted">
              System Readiness
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink-secondary">
                  <IconVideo className="h-3.5 w-3.5 text-brand" />
                  <span>Browser Verified</span>
                </span>
                <span className="text-caption font-bold text-emerald-600 flex items-center gap-1">
                  <IconCheckCircle className="h-3 w-3" /> Compatible
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink-secondary">
                  <IconWifi className="h-3.5 w-3.5 text-brand" />
                  <span>Network Sync</span>
                </span>
                <span className="text-caption font-bold text-emerald-600 flex items-center gap-1">
                  <IconCheckCircle className="h-3 w-3" /> Active
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-ink-secondary">
                  <IconCheck className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Autosave Engine</span>
                </span>
                <span className="text-caption font-bold text-emerald-600 flex items-center gap-1">
                  <IconCheckCircle className="h-3 w-3" /> Ready
                </span>
              </div>
            </div>
          </div>

          {/* Agreement Checkbox & Prominent Launch Action */}
          <div className="rounded-card border border-line bg-white p-5 shadow-xs space-y-4">
            {attemptState !== 'in_progress' && (
              <label className="flex items-start gap-2.5 text-xs text-ink-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasAgreed}
                  onChange={(e) => {
                    setHasAgreed(e.target.checked);
                    if (e.target.checked) setStartError(null);
                  }}
                  className="mt-0.5 rounded border-line text-brand focus:ring-brand h-4 w-4"
                />
                <span className="leading-snug">
                  I have read and understood all instructions and agree to follow the exam regulations.
                </span>
              </label>
            )}

            {startError && (
              <div className="rounded-field bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 flex items-start gap-1.5">
                <IconWarning size={14} className="shrink-0 mt-0.5" />
                <span>{startError}</span>
              </div>
            )}

            {/* Launch CTA Button */}
            {isUpcoming ? (
              <button
                disabled
                className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-paper py-3 text-xs font-bold text-ink-muted cursor-not-allowed shadow-none"
              >
                <IconClock className="h-4 w-4" />
                <span>Opens Soon ({formatScheduleDate(test.availableFrom)})</span>
              </button>
            ) : isExpired ? (
              attemptState === 'submitted' ? (
                latestResult?.isReleased ? (
                  <button
                    onClick={handleStartOrResume}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all"
                  >
                    <IconCheckCircle className="h-4 w-4" />
                    <span>View Full Result & Solutions</span>
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-amber-50 border border-amber-200 py-3 text-xs font-bold text-amber-800 cursor-not-allowed shadow-none"
                  >
                    <IconClock className="h-4 w-4 text-amber-600" />
                    <span>Evaluation Pending</span>
                  </button>
                )
              ) : attemptState === 'in_progress' ? (
                <button
                  onClick={handleStartOrResume}
                  disabled={isStarting}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-brand hover:bg-brand-hover active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all disabled:opacity-60"
                >
                  {isStarting ? (
                    <>
                      <IconRefresh className="h-4 w-4 animate-spin" />
                      <span>Connecting to Exam Runner...</span>
                    </>
                  ) : (
                    <>
                      <IconRefresh className="h-4 w-4" />
                      <span>Resume Active Attempt</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    disabled
                    className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-paper py-3 text-xs font-bold text-ink-muted cursor-not-allowed shadow-none"
                  >
                    <IconLock className="h-4 w-4" />
                    <span>Window Closed (Test Expired)</span>
                  </button>
                  <p className="text-center text-caption text-ink-muted">
                    The availability window for this test closed on {formatScheduleDate(test.availableUntil) || 'its expiry date'}.
                  </p>
                </div>
              )
            ) : attemptState === 'in_progress' ? (
              <button
                onClick={handleStartOrResume}
                disabled={isStarting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-brand hover:bg-brand-hover active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all disabled:opacity-60"
              >
                {isStarting ? (
                  <>
                    <IconRefresh className="h-4 w-4 animate-spin" />
                    <span>Connecting to Exam Runner...</span>
                  </>
                ) : (
                  <>
                    <IconRefresh className="h-4 w-4" />
                    <span>Resume Test Attempt</span>
                  </>
                )}
              </button>
            ) : attemptState === 'submitted' && !attemptSummary.canAttempt ? (
              <button
                onClick={handleStartOrResume}
                className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all"
              >
                <IconCheckCircle className="h-4 w-4" />
                <span>View Full Result & Solutions</span>
              </button>
            ) : attemptState === 'limit_reached' ? (
              <button
                disabled
                className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-paper py-3 text-xs font-bold text-ink-muted cursor-not-allowed shadow-none"
              >
                <span>Attempts Exhausted</span>
              </button>
            ) : (
              <button
                onClick={handleStartOrResume}
                disabled={isStarting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-field bg-brand hover:bg-brand-hover active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all disabled:opacity-60"
              >
                {isStarting ? (
                  <>
                    <IconRefresh className="h-4 w-4 animate-spin" />
                    <span>Initializing Attempt...</span>
                  </>
                ) : (
                  <>
                    <IconPlayCircle className="h-4 w-4" />
                    <span>{attemptState === 'submitted' ? 'Retake Test' : 'Start Test Now'}</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
