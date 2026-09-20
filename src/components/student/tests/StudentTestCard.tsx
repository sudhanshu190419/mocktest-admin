'use client';

/**
 * StudentTestCard Component
 *
 * Premium exam & assessment card for the Student Exam Center (/student/tests).
 * Matches MockTestApp educational design system:
 *   - Clean white card with subtle slate-200 border & hover lift
 *   - Real duration, marks, question counts, negative marks
 *   - Real attempt states (Not Started, In Progress, Submitted, Limit Reached)
 *   - Performance scorecard snippet for submitted attempts
 *
 * @module components/student/tests/StudentTestCard
 */

import React from 'react';
import Link from 'next/link';
import {
  Exam,
  Clock,
  BookOpen,
  Trophy,
  WarningCircle,
  PlayCircle,
  ArrowClockwise,
  CheckCircle,
  ArrowRight,
  Sparkle,
  CalendarBlank,
  LockKey,
} from '@phosphor-icons/react';
import type { StudentMockTestCardItem } from '@/services/student/studentTestWebService';

interface StudentTestCardProps {
  test: StudentMockTestCardItem;
  onSelect?: (testId: string) => void;
}

export const StudentTestCard: React.FC<StudentTestCardProps> = ({ test, onSelect }) => {
  const {
    testId,
    title,
    description,
    testType,
    subjectName,
    courseTitle,
    batchName,
    durationMin,
    totalMarks,
    negativeMarking,
    questionCount,
    attemptLimit,
    availabilityStatus,
    attemptSummary,
    latestResult,
    availableFrom,
    availableUntil,
  } = test;

  const attemptState = attemptSummary.attemptState;
  const isAvailable = availabilityStatus === 'available';
  const isUpcoming = availabilityStatus === 'upcoming';
  const isExpired = availabilityStatus === 'expired';

  // Determine Badge Status and Theme
  let statusBadgeText = 'Ready to Attempt';
  let statusBadgeClass = 'bg-sky-tint text-brand-hover border-line';
  let statusIcon = <Sparkle className="h-3.5 w-3.5" weight="bold" />;

  if (isUpcoming) {
    statusBadgeText = 'Scheduled Soon';
    statusBadgeClass = 'bg-amber-50 text-amber-700 border-amber-200';
    statusIcon = <Clock className="h-3.5 w-3.5" weight="bold" />;
  } else if (isExpired) {
    statusBadgeText = 'Window Closed';
    statusBadgeClass = 'bg-paper text-ink-secondary border-line';
    statusIcon = <LockKey className="h-3.5 w-3.5" />;
  } else if (attemptState === 'in_progress') {
    statusBadgeText = 'In Progress';
    statusBadgeClass = 'bg-sky-tint text-brand-hover border-line';
    statusIcon = <ArrowClockwise className="h-3.5 w-3.5" weight="bold" />;
  } else if (attemptState === 'limit_reached') {
    statusBadgeText = 'Attempts Exhausted';
    statusBadgeClass = 'bg-paper text-ink-secondary border-line';
    statusIcon = <CheckCircle className="h-3.5 w-3.5" weight="fill" />;
  } else if (attemptState === 'submitted') {
    statusBadgeText = 'Attempted & Evaluated';
    statusBadgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    statusIcon = <CheckCircle className="h-3.5 w-3.5" weight="bold" />;
  }

  // Format Test Type Label
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

  // Format Dates
  const formatDateTime = (isoStr?: string | null) => {
    if (!isoStr) return null;
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return null;
    }
  };

  const targetHref = '/student/tests/' + testId;
  const attemptId = latestResult?.attemptId || attemptSummary?.latestAttemptId;
  const resultHref = attemptId ? ('/student/tests/' + testId + '/results/' + attemptId) : targetHref;

  return (
    <div className="group flex flex-col justify-between rounded-card border border-line bg-surface p-5 sm:p-6 shadow-card transition-[border-color,box-shadow] duration-200 ease-coach hover:border-brand/40 hover:shadow-hover">
      <div>
        {/* Top Badges Row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-xs font-bold text-ink">
              <Exam className="h-3.5 w-3.5 text-brand" />
              {formatTestType(testType)}
            </span>
            {subjectName && (
              <span className="inline-flex items-center rounded-lg bg-sky-tint px-2.5 py-0.5 text-xs font-semibold text-brand-hover border border-line">
                {subjectName}
              </span>
            )}
          </div>

          <span
            className={'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-bold border ' + statusBadgeClass}
          >
            {statusIcon}
            <span>{statusBadgeText}</span>
          </span>
        </div>

        {/* Title and Course Track info */}
        <div className="mt-3.5">
          <Link
            href={attemptState === 'submitted' || attemptState === 'limit_reached' ? resultHref : (isExpired ? (attemptId ? resultHref : '#') : targetHref)}
            className="text-base sm:text-lg font-bold text-ink line-clamp-1 group-hover:text-brand transition-colors"
          >
            {title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            {courseTitle && <span className="font-medium text-ink-secondary">{courseTitle}</span>}
            {courseTitle && batchName && <span className="text-ink-muted">•</span>}
            {batchName && <span>{batchName}</span>}
          </div>
        </div>

        {/* Description / Subtext */}
        {description ? (
          <p className="mt-2 text-xs text-ink-secondary line-clamp-2 leading-relaxed">{description}</p>
        ) : (
          <p className="mt-2 text-xs text-ink-muted">
            Timed test assessment with immediate scorecard, accuracy analysis & step-by-step solutions.
          </p>
        )}

        {/* Performance Result Scorecard (If Completed / Submitted) */}
        {latestResult && attemptState === 'submitted' && (
          <Link
            href={resultHref}
            className="mt-4 block rounded-xl border border-emerald-100 bg-gradient-to-r from-emerald-50/60 to-white p-3 hover:border-emerald-300 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-caption font-bold uppercase tracking-wider text-emerald-800">
                  Latest Scorecard
                </p>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-lg font-extrabold text-emerald-950">
                    {latestResult.totalScore}
                  </span>
                  <span className="text-xs font-medium text-ink-secondary">
                    / {latestResult.maxScore} marks
                  </span>
                  <span className="ml-2 inline-flex items-center rounded-md bg-emerald-100 px-1.5 py-0.5 text-caption font-bold text-emerald-800">
                    {latestResult.percentage}% Score
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-ink">
                  {latestResult.accuracy}% Accuracy
                </span>
                <p className="text-caption text-ink-muted mt-0.5">
                  {latestResult.correctCount} Correct • {latestResult.wrongCount} Wrong
                </p>
              </div>
            </div>
          </Link>
        )}

        {/* In-Progress Notification banner */}
        {attemptState === 'in_progress' && (
          <div className="mt-4 rounded-xl border border-line bg-sky-tint/70 p-3">
            <div className="flex items-center gap-2">
              <ArrowClockwise className="h-4 w-4 text-brand animate-spin" />
              <p className="text-xs font-bold text-brand-hover">
                You have an active in-progress attempt.
              </p>
            </div>
            <p className="mt-1 text-caption text-brand-hover">
              Resume to complete your questions before the time window expires.
            </p>
          </div>
        )}

        {/* 4-Column Metric Grid */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-line pt-3 text-center">
          <div className="rounded-xl bg-paper p-2.5">
            <Clock className="h-3.5 w-3.5 text-ink-muted mx-auto" />
            <p className="text-caption font-medium text-ink-muted mt-1">Duration</p>
            <p className="text-xs font-bold text-ink mt-0.5">
              {durationMin !== null ? (durationMin + ' mins') : 'Flexible'}
            </p>
          </div>

          <div className="rounded-xl bg-paper p-2.5">
            <BookOpen className="h-3.5 w-3.5 text-brand mx-auto" />
            <p className="text-caption font-medium text-ink-muted mt-1">Questions</p>
            <p className="text-xs font-bold text-ink mt-0.5">
              {questionCount > 0 ? (questionCount + ' Qs') : 'Configured'}
            </p>
          </div>

          <div className="rounded-xl bg-paper p-2.5">
            <Trophy className="h-3.5 w-3.5 text-emerald-500 mx-auto" />
            <p className="text-caption font-medium text-ink-muted mt-1">Max Marks</p>
            <p className="text-xs font-bold text-ink mt-0.5">
              {totalMarks !== null ? totalMarks : '—'}
            </p>
          </div>

          <div className="rounded-xl bg-paper p-2.5">
            <WarningCircle className="h-3.5 w-3.5 text-amber-500 mx-auto" />
            <p className="text-caption font-medium text-ink-muted mt-1">Negative</p>
            <p className="text-xs font-bold text-ink mt-0.5">
              {negativeMarking > 0 ? ('-' + negativeMarking) : 'None'}
            </p>
          </div>
        </div>

        {/* Assigned & Expiry Date Row */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper/80 px-3 py-2 text-caption border border-line">
          <div className="flex items-center gap-1.5 text-ink-secondary">
            <CalendarBlank className="h-3.5 w-3.5 text-ink-muted shrink-0" />
            <span className="text-ink-muted font-medium">Assigned:</span>
            <span className="font-semibold text-ink">
              {test.assignedAt ? (formatDateTime(test.assignedAt) || 'Assigned') : (test.availableFrom ? formatDateTime(test.availableFrom) : 'Available')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-ink-secondary">
            <Clock className="h-3.5 w-3.5 text-ink-muted shrink-0" />
            <span className="text-ink-muted font-medium">Expires:</span>
            <span className={'font-semibold ' + (isExpired ? 'text-rose-600' : 'text-ink')}>
              {test.availableUntil ? (formatDateTime(test.availableUntil) || 'No Expiry') : 'No Expiry'}
            </span>
          </div>
        </div>

        {/* Schedule metadata footer if upcoming */}
        {availableFrom && isUpcoming && (
          <div className="mt-3 flex items-center gap-1.5 text-caption text-amber-700 bg-amber-50/60 rounded-lg px-2.5 py-1.5 border border-amber-100">
            <CalendarBlank className="h-3.5 w-3.5 shrink-0" />
            <span>Opens: {formatDateTime(availableFrom)}</span>
          </div>
        )}
      </div>

      {/* Bottom CTA Row */}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="text-caption text-ink-secondary font-medium">
          {attemptLimit
            ? ('Attempt Limit: ' + attemptLimit + ' times (' + attemptSummary.attemptsUsed + ' used)')
            : 'Unlimited Practice Attempts'}
        </span>

        {isUpcoming ? (
          <button
            disabled
            className="inline-flex items-center gap-1.5 rounded-xl bg-paper px-4 py-2 text-xs font-bold text-ink-muted cursor-not-allowed"
          >
            <Clock className="h-3.5 w-3.5" />
            <span>Opens Soon</span>
          </button>
        ) : isExpired ? (
          attemptState === 'submitted' ? (
            latestResult?.isReleased ? (
              <div className="flex items-center gap-2">
                <Link
                  href={resultHref}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.98] transition-all"
                >
                  <CheckCircle className="h-3.5 w-3.5" weight="bold" />
                  <span>View results</span>
                </Link>
                <Link
                  href={`${resultHref}/review`}
                  className="inline-flex items-center gap-1 rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-paper transition-colors"
                >
                  <span>Review</span>
                  <ArrowRight className="h-3 w-3 text-ink-muted" />
                </Link>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
                <span>Evaluation Pending</span>
              </span>
            )
          ) : attemptState === 'in_progress' ? (
            <Link
              href={targetHref}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-brand-hover active:scale-[0.98] transition-all"
            >
              <ArrowClockwise className="h-3.5 w-3.5" weight="bold" />
              <span>Resume</span>
            </Link>
          ) : (
            <button
              disabled
              className="inline-flex items-center gap-1.5 rounded-xl bg-paper px-4 py-2 text-xs font-bold text-ink-muted cursor-not-allowed"
            >
              <LockKey className="h-3.5 w-3.5" />
              <span>Window Closed</span>
            </button>
          )
        ) : attemptState === 'in_progress' ? (
          <Link
            href={targetHref}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-brand-hover active:scale-[0.98] transition-all"
          >
            <ArrowClockwise className="h-3.5 w-3.5" weight="bold" />
            <span>Resume</span>
          </Link>
        ) : attemptState === 'submitted' ? (
          <div className="flex items-center gap-2">
            <Link
              href={resultHref}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.98] transition-all"
            >
              <CheckCircle className="h-3.5 w-3.5" weight="bold" />
              <span>View results</span>
            </Link>
            {attemptSummary.canAttempt && (
              <Link
                href={targetHref}
                className="inline-flex items-center gap-1 rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-paper transition-colors"
              >
                <span>Retake</span>
                <ArrowRight className="h-3 w-3 text-ink-muted" />
              </Link>
            )}
          </div>
        ) : attemptState === 'limit_reached' ? (
          <Link
            href={resultHref}
            className="inline-flex items-center gap-1.5 rounded-xl bg-paper px-4 py-2 text-xs font-bold text-ink-secondary hover:bg-sky-tint transition-colors"
          >
            <span>View results</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <Link
            href={targetHref}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-brand-hover active:scale-[0.98] transition-all"
          >
            <PlayCircle className="h-4 w-4" weight="bold" />
            <span>Start Test</span>
          </Link>
        )}
      </div>
    </div>
  );
};
