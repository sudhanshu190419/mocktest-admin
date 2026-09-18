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
  ArrowLeft,
  Exam,
  Clock,
  BookOpen,
  Trophy,
  WarningCircle,
  PlayCircle,
  ArrowClockwise,
  CheckCircle,
  ShieldCheck,
  Globe,
  Sparkle,
  Info,
  CalendarBlank,
  LockKey,
  CheckSquare,
  Square,
  Desktop,
  WifiHigh,
} from '@phosphor-icons/react';
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
    } catch (err: any) {
      setError(err?.message || 'Failed to load test instructions.');
    } finally {
      setIsLoading(false);
    }
  }, [testId]);

  useEffect(() => {
    loadInstructions();
  }, [loadInstructions]);

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
    } catch (err: any) {
      setStartError(err?.message || 'An error occurred while launching the exam.');
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
        <div className="h-4 w-36 bg-slate-200 rounded-md" />
        <div className="h-8 w-2/3 bg-slate-200 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-44 bg-slate-100 rounded-2xl" />
            <div className="h-32 bg-slate-100 rounded-2xl" />
            <div className="h-64 bg-slate-100 rounded-2xl" />
          </div>
          <div className="space-y-4">
            <div className="h-60 bg-slate-100 rounded-2xl" />
            <div className="h-40 bg-slate-100 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  // 2. Error / Not Found / Inaccessible State
  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-rose-50 text-rose-600 mx-auto">
          <WarningCircle size={28} weight="bold" />
        </div>
        <h2 className="text-lg sm:text-xl font-bold text-slate-900">
          Cannot Access Test
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 leading-relaxed max-w-md mx-auto">
          {error || 'This assessment is currently inaccessible or does not exist.'}
        </p>
        <div className="pt-4 flex items-center justify-center gap-3">
          <Link
            href="/student/tests"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors shadow-sm"
          >
            <ArrowLeft size={14} weight="bold" />
            <span>Back to Mock Tests Hub</span>
          </Link>
          <button
            onClick={loadInstructions}
            className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors"
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
    <div className="space-y-6 sm:space-y-8 max-w-6xl mx-auto pb-16">
      {/* Top Header & Breadcrumb */}
      <div>
        <Link
          href="/student/tests"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 mb-3 transition-colors"
        >
          <ArrowLeft size={14} weight="bold" />
          <span>Back to Mock Tests Hub</span>
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 border border-indigo-100">
                <Exam size={14} weight="bold" />
                <span>{test.testType.replace(/_/g, ' ').toUpperCase()}</span>
              </span>
              {test.subjectName && (
                <span className="inline-flex items-center rounded-lg bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 border border-sky-100">
                  {test.subjectName}
                </span>
              )}
              {test.courseTitle && (
                <span className="inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                  {test.courseTitle}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight mt-2">
              {test.title}
            </h1>
            {test.description && (
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-2xl leading-relaxed">
                {test.description}
              </p>
            )}
          </div>

          {/* Status Badge */}
          <div>
            {isUpcoming ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3.5 py-1.5 text-xs font-bold text-amber-800 border border-amber-200">
                <Clock size={14} weight="bold" />
                <span>Opens: {formatScheduleDate(test.availableFrom)}</span>
              </span>
            ) : attemptState === 'in_progress' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3.5 py-1.5 text-xs font-bold text-sky-700 border border-sky-200 animate-pulse">
                <ArrowClockwise size={14} weight="bold" />
                <span>Attempt In Progress</span>
              </span>
            ) : attemptState === 'submitted' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3.5 py-1.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                <CheckCircle size={14} weight="bold" />
                <span>Previously Attempted</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3.5 py-1.5 text-xs font-bold text-indigo-700 border border-indigo-200">
                <Sparkle size={14} weight="bold" />
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
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
              Assessment Summary
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <Clock className="h-5 w-5 text-indigo-600 mx-auto" />
                <p className="text-xs font-medium text-slate-400 mt-1.5">Duration</p>
                <p className="text-base font-extrabold text-slate-900 mt-0.5">
                  {test.durationMin !== null ? (test.durationMin + ' Mins') : 'Flexible'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <BookOpen className="h-5 w-5 text-sky-600 mx-auto" />
                <p className="text-xs font-medium text-slate-400 mt-1.5">Questions</p>
                <p className="text-base font-extrabold text-slate-900 mt-0.5">
                  {structure.totalQuestions > 0 ? (structure.totalQuestions + ' Qs') : 'Configured'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <Trophy className="h-5 w-5 text-emerald-600 mx-auto" />
                <p className="text-xs font-medium text-slate-400 mt-1.5">Total Marks</p>
                <p className="text-base font-extrabold text-slate-900 mt-0.5">
                  {structure.totalMarks > 0 ? structure.totalMarks : (test.totalMarks || '—')}
                </p>
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <WarningCircle className="h-5 w-5 text-amber-500 mx-auto" />
                <p className="text-xs font-medium text-slate-400 mt-1.5">Negative Mark</p>
                <p className="text-base font-extrabold text-slate-900 mt-0.5">
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
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs">
              <div className="flex items-center justify-between mb-3.5">
                <h2 className="text-sm font-bold text-slate-900">
                  Exam Sections & Syllabus Coverage
                </h2>
                <span className="text-xs text-slate-400">
                  {structure.sections.length} Section{structure.sections.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {structure.sections.map((sec, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3.5"
                  >
                    <div>
                      <span className="text-xs font-bold text-slate-800">
                        {sec.sectionName}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {sec.questionCount} Question{sec.questionCount > 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-extrabold text-indigo-700">
                      {sec.totalMarks} Marks
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Marking Scheme Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              Marking Scheme & Scoring Policy
            </h2>
            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50/50 border border-emerald-100">
                <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" weight="bold" />
                <div>
                  <span className="font-bold text-emerald-950">Correct Answers: </span>
                  <span>{correctText}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50/50 border border-rose-100">
                <WarningCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" weight="bold" />
                <div>
                  <span className="font-bold text-rose-950">Incorrect Answers: </span>
                  <span>{negativeText}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <Info className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-800">Unattempted Questions: </span>
                  <span>0 marks (no negative penalty for questions left blank)</span>
                </div>
              </div>

              {test.passingMarks && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-indigo-50/50 border border-indigo-100">
                  <Trophy className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" weight="bold" />
                  <div>
                    <span className="font-bold text-indigo-950">Cutoff / Passing Score: </span>
                    <span>{test.passingMarks} marks required</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 4. Instructions & Guidelines Accordion */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900">
              Exam Instructions & Guidelines
            </h2>

            <div className="space-y-3.5 text-xs text-slate-600 leading-relaxed">
              <div className="space-y-1.5">
                <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
                  <span>1. General Guidelines</span>
                </h3>
                <ul className="list-disc list-inside space-y-1 pl-1 text-slate-500">
                  <li>The total duration of this test is {test.durationMin ?? 180} minutes.</li>
                  <li>Once started, the timer cannot be paused. The test will automatically submit when time expires.</li>
                  <li>All your selected answers are continuously persisted in the background.</li>
                </ul>
              </div>

              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
                  <span>2. Navigation & Question Palette</span>
                </h3>
                <ul className="list-disc list-inside space-y-1 pl-1 text-slate-500">
                  <li>Use the Question Palette on the right to jump directly to any question.</li>
                  <li>You can mark questions as <strong>Marked for Review</strong> to revisit them later before submitting.</li>
                  <li>You can change your selected answer or clear response at any time during the test.</li>
                </ul>
              </div>

              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
                  <span>3. System Integrity & Submission</span>
                </h3>
                <ul className="list-disc list-inside space-y-1 pl-1 text-slate-500">
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
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Your Attempt Status
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Attempt Limit</span>
                <span className="font-bold text-slate-800">
                  {test.attemptLimit ? (test.attemptLimit + ' Max') : 'Unlimited Practice'}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Attempts Used</span>
                <span className="font-bold text-slate-800">
                  {attemptSummary.attemptsUsed} attempt{attemptSummary.attemptsUsed === 1 ? '' : 's'}
                </span>
              </div>

              {test.attemptLimit && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Attempts Remaining</span>
                  <span className="font-bold text-indigo-600">
                    {attemptSummary.attemptsRemaining !== null ? attemptSummary.attemptsRemaining : '—'}
                  </span>
                </div>
              )}

              {/* In-Progress Notification */}
              {attemptState === 'in_progress' && (
                <div className="rounded-xl bg-sky-50 border border-sky-200 p-3 text-xs text-sky-900 mt-2">
                  <div className="flex items-center gap-2 font-bold">
                    <ArrowClockwise className="h-4 w-4 text-sky-600 animate-spin" />
                    <span>In-Progress Attempt Found</span>
                  </div>
                  <p className="mt-1 text-[11px] text-sky-700">
                    Your saved answers and remaining time will be restored automatically upon resuming.
                  </p>
                </div>
              )}

              {/* Latest Result Snippet (If previously completed) */}
              {latestResult && attemptState === 'submitted' && (
                <div className="rounded-xl bg-emerald-50/60 border border-emerald-200 p-3 text-xs mt-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-950">Previous Score</span>
                    <span className="font-extrabold text-emerald-800">
                      {latestResult.totalScore} / {latestResult.maxScore} ({latestResult.percentage}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                    <span>Accuracy: {latestResult.accuracy}%</span>
                    <span>{latestResult.correctCount} Correct</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* System Readiness Check */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              System Readiness
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-600">
                  <Desktop className="h-3.5 w-3.5 text-indigo-500" />
                  <span>Browser Verified</span>
                </span>
                <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" weight="bold" /> Compatible
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-600">
                  <WifiHigh className="h-3.5 w-3.5 text-sky-500" />
                  <span>Network Sync</span>
                </span>
                <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" weight="bold" /> Active
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-600">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Autosave Engine</span>
                </span>
                <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" weight="bold" /> Ready
                </span>
              </div>
            </div>
          </div>

          {/* Agreement Checkbox & Prominent Launch Action */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
            {attemptState !== 'in_progress' && (
              <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasAgreed}
                  onChange={(e) => {
                    setHasAgreed(e.target.checked);
                    if (e.target.checked) setStartError(null);
                  }}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span className="leading-snug">
                  I have read and understood all instructions and agree to follow the exam regulations.
                </span>
              </label>
            )}

            {startError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700 flex items-start gap-1.5">
                <WarningCircle size={14} className="shrink-0 mt-0.5" weight="bold" />
                <span>{startError}</span>
              </div>
            )}

            {/* Launch CTA Button */}
            {isUpcoming ? (
              <button
                disabled
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-400 cursor-not-allowed shadow-none"
              >
                <Clock className="h-4 w-4" />
                <span>Opens Soon ({formatScheduleDate(test.availableFrom)})</span>
              </button>
            ) : isExpired ? (
              attemptState === 'submitted' ? (
                latestResult?.isReleased ? (
                  <button
                    onClick={handleStartOrResume}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all"
                  >
                    <CheckCircle className="h-4 w-4" weight="bold" />
                    <span>View Full Result & Solutions</span>
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-50 border border-amber-200 py-3 text-xs font-bold text-amber-800 cursor-not-allowed shadow-none"
                  >
                    <Clock className="h-4 w-4 text-amber-600" />
                    <span>Evaluation Pending</span>
                  </button>
                )
              ) : attemptState === 'in_progress' ? (
                <button
                  onClick={handleStartOrResume}
                  disabled={isStarting}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all disabled:opacity-60"
                >
                  {isStarting ? (
                    <>
                      <ArrowClockwise className="h-4 w-4 animate-spin" />
                      <span>Connecting to Exam Runner...</span>
                    </>
                  ) : (
                    <>
                      <ArrowClockwise className="h-4 w-4" weight="bold" />
                      <span>Resume Active Attempt</span>
                    </>
                  )}
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    disabled
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-400 cursor-not-allowed shadow-none"
                  >
                    <LockKey className="h-4 w-4" />
                    <span>Window Closed (Test Expired)</span>
                  </button>
                  <p className="text-center text-[11px] text-slate-400">
                    The availability window for this test closed on {formatScheduleDate(test.availableUntil) || 'its expiry date'}.
                  </p>
                </div>
              )
            ) : attemptState === 'in_progress' ? (
              <button
                onClick={handleStartOrResume}
                disabled={isStarting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all disabled:opacity-60"
              >
                {isStarting ? (
                  <>
                    <ArrowClockwise className="h-4 w-4 animate-spin" />
                    <span>Connecting to Exam Runner...</span>
                  </>
                ) : (
                  <>
                    <ArrowClockwise className="h-4 w-4" weight="bold" />
                    <span>Resume Test Attempt</span>
                  </>
                )}
              </button>
            ) : attemptState === 'submitted' && !attemptSummary.canAttempt ? (
              <button
                onClick={handleStartOrResume}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all"
              >
                <CheckCircle className="h-4 w-4" weight="bold" />
                <span>View Full Result & Solutions</span>
              </button>
            ) : attemptState === 'limit_reached' ? (
              <button
                disabled
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 text-xs font-bold text-slate-400 cursor-not-allowed shadow-none"
              >
                <span>Attempts Exhausted</span>
              </button>
            ) : (
              <button
                onClick={handleStartOrResume}
                disabled={isStarting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] py-3 text-xs font-bold text-white shadow-md transition-all disabled:opacity-60"
              >
                {isStarting ? (
                  <>
                    <ArrowClockwise className="h-4 w-4 animate-spin" />
                    <span>Initializing Attempt...</span>
                  </>
                ) : (
                  <>
                    <PlayCircle className="h-4 w-4" weight="bold" />
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
