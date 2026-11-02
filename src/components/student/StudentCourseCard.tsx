'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  IconVideo,
  IconFileText,
  IconPlayCircle,
  IconGraduationCap,
  IconTest,
} from '@/components/icons/student-icons';
import {
  CreditCard,
  Receipt,
  CaretDown,
  CaretUp,
  CheckCircle,
  WarningCircle,
  Clock,
  Sparkle,
  Hourglass,
  Tag,
} from '@phosphor-icons/react';
import type { StudentCourseHubItem } from '@/services/student/studentCourseWebService';
import { formatCoursePrice } from '@/services/courseCatalogService';
import { ProgressBar } from '@/components/ui/mmt/ProgressBar';
import { StudentCourseInstallmentSchedule } from '@/components/student/StudentCourseInstallmentSchedule';

interface StudentCourseCardProps {
  course: StudentCourseHubItem;
  isScheduleExpanded?: boolean;
  onToggleSchedule?: () => void;
  highlightOverdue?: boolean;
  targetInstallmentIndex?: number | null;
  onPaymentSettled?: () => void;
}

export const StudentCourseCard: React.FC<StudentCourseCardProps> = ({
  course,
  isScheduleExpanded = false,
  onToggleSchedule,
  highlightOverdue = false,
  targetInstallmentIndex,
  onPaymentSettled,
}) => {
  // Local fallback if controlled expansion is not provided
  const [localExpanded, setLocalExpanded] = useState<boolean>(false);
  const isExpanded = onToggleSchedule ? isScheduleExpanded : localExpanded;
  const toggleSchedule = onToggleSchedule || (() => setLocalExpanded((prev) => !prev));

  const isInstallment = course.acquisitionType === 'installment';
  const isAssigned = course.batchStatus === 'assigned';
  const fin = course.financialSummary;

  const resumeHref = course.firstAvailableBatchSubjectId
    ? `/student/courses/${course.courseId}/subjects/${course.firstAvailableBatchSubjectId}`
    : `/student/courses/${course.courseId}`;

  // Formatted date helper
  const formatFriendlyDate = (dateStr?: string | null) => {
    if (!dateStr) return 'N/A';
    try {
      const [year, month, day] = dateStr.split('-');
      if (year && month && day) {
        const d = new Date(Number(year), Number(month) - 1, Number(day));
        return d.toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  return (
    <article
      id={`course-card-${course.courseId}`}
      className={`group flex flex-col justify-between rounded-card border bg-surface p-5 sm:p-6 shadow-card transition-all duration-200 ${
        highlightOverdue && fin?.hasArrears
          ? 'border-amber-400 ring-2 ring-amber-300/60 shadow-card-hover'
          : 'border-line hover:border-line hover:shadow-card-hover'
      }`}
    >
      {/* ── Top Header Section: Badges & Title ─────────────────────────────── */}
      <div>
        {/* Badges Row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Category / Stream Tag */}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3 py-1 text-caption font-bold text-brand-hover border border-line">
            <IconGraduationCap className="h-3.5 w-3.5" />
            {course.category || course.streamName || 'Academic Track'}
          </span>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Acquisition Pill (§5, §7) */}
            {isInstallment ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-1 text-caption font-bold text-purple-700 border border-purple-200">
                <Receipt size={13} weight="bold" />
                <span>Installment Plan</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-caption font-bold text-emerald-700 border border-emerald-200">
                <Tag size={13} weight="bold" />
                <span>One-Time Purchase</span>
              </span>
            )}

            {/* Installment Financial State Badge (§6, §7) */}
            {isInstallment && (
              <>
                {course.scheduleError ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-1 text-caption font-bold text-sand-ink border border-amber-300">
                    <WarningCircle size={13} weight="fill" />
                    <span>Schedule Unavailable</span>
                  </span>
                ) : fin?.requiresAdminReview ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-caption font-bold text-amber-800 border border-amber-300">
                    <WarningCircle size={13} weight="fill" />
                    <span>Under Review</span>
                  </span>
                ) : fin ? (
                  fin.hasStatusDiscrepancy && course.agreement?.agreement_status === 'completed' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-caption font-bold text-amber-800 border border-amber-300">
                      <WarningCircle size={13} weight="fill" />
                      <span>Reconciliation Pending</span>
                    </span>
                  ) : fin.hasArrears ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-1 text-caption font-bold text-sand-ink border border-amber-300">
                      <WarningCircle size={13} weight="fill" />
                      <span>In Arrears</span>
                    </span>
                  ) : fin.isFullyPaid ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-mint-tint px-2.5 py-1 text-caption font-bold text-mint-ink border border-emerald-200">
                      <CheckCircle size={13} weight="fill" />
                      <span>Fully Settled</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-tint px-2.5 py-1 text-caption font-semibold text-brand border border-blue-200">
                      <Clock size={13} weight="fill" />
                      <span>Active Plan</span>
                    </span>
                  )
                ) : null}
              </>
            )}

            {/* Batch Status Badge (§4) */}
            {isAssigned ? (
              <span className="inline-flex items-center rounded-field bg-paper px-2.5 py-1 text-caption font-semibold text-ink-secondary border border-line">
                {course.batchName} {course.batchCode ? `(${course.batchCode})` : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-field bg-amber-50 px-2.5 py-1 text-caption font-bold text-amber-800 border border-amber-200">
                <Hourglass size={13} weight="fill" />
                <span>Batch Assignment Pending</span>
              </span>
            )}
          </div>
        </div>

        {/* Course Title & Description */}
        <h3 className="mt-3.5 text-h3 font-extrabold text-ink line-clamp-1 group-hover:text-brand transition-colors">
          {course.title}
        </h3>
        {course.description ? (
          <p className="mt-1 text-body text-ink-secondary line-clamp-2 leading-relaxed">
            {course.description}
          </p>
        ) : (
          <p className="mt-1 text-body text-ink-secondary">
            Comprehensive curriculum, video lectures, revision notes & mock test series.
          </p>
        )}

        {/* ── Unassigned Batch State Notice Banner (§4) ────────────────────── */}
        {!isAssigned && (
          <div className="mt-4 p-3.5 rounded-field bg-amber-50/70 border border-amber-200/80 text-amber-900 text-xs leading-relaxed space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-800">
              <Hourglass className="h-4 w-4 shrink-0" weight="fill" />
              <span>Enrollment Confirmed — Batch Assignment Pending</span>
            </div>
            <p className="text-amber-800/90 text-[11px]">
              Your course agreement has been verified. Batch-specific learning curriculum, live classes, and recordings will become accessible as soon as your institute administrator completes your batch assignment.
            </p>
          </div>
        )}

        {/* ── Academic Progress & Content (Shown ONLY when batch is assigned) ── */}
        {isAssigned && (
          <>
            {/* Progress Bar */}
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center justify-between text-caption font-bold">
                <span className="text-ink-secondary uppercase tracking-wider">Course Progress</span>
                <span className="text-ink tabular-nums">{course.progress}%</span>
              </div>
              <ProgressBar
                value={course.progress}
                label={`${course.title} progress`}
                tone={course.progress >= 80 ? 'success' : 'brand'}
              />
            </div>

            {/* Subjects List */}
            {course.subjects && course.subjects.length > 0 && (
              <div className="mt-4">
                <p className="text-caption font-bold uppercase tracking-wider text-ink-secondary">
                  Subject Tracks
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {course.subjects.map((sub) => (
                    <Link
                      key={sub.batchSubjectId || sub.subjectId}
                      href={`/student/courses/${course.courseId}/subjects/${sub.batchSubjectId || sub.subjectId}`}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-field border border-line bg-paper px-2.5 py-1 text-caption font-medium text-ink hover:border-brand hover:bg-sky-tint transition-colors"
                    >
                      <span>{sub.emoji}</span>
                      <span>{sub.subjectName}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Content Availability Badges */}
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
              <div className="rounded-field bg-sky-tint p-2">
                <div className="flex items-center justify-center gap-1 text-brand-hover">
                  <IconVideo className="h-3.5 w-3.5" />
                  <span className="text-body font-bold tabular-nums">{course.totalLectures}</span>
                </div>
                <p className="text-caption text-ink-secondary mt-0.5">Lectures</p>
              </div>
              <div className="rounded-field bg-mint-tint p-2">
                <div className="flex items-center justify-center gap-1 text-mint-ink">
                  <IconFileText className="h-3.5 w-3.5" />
                  <span className="text-body font-bold tabular-nums">
                    {course.totalPdfs + course.totalNotes}
                  </span>
                </div>
                <p className="text-caption text-ink-secondary mt-0.5">Notes & PDFs</p>
              </div>
              <div className="rounded-field bg-lilac-tint p-2">
                <div className="flex items-center justify-center gap-1 text-lilac-ink">
                  <IconTest className="h-3.5 w-3.5" />
                  <span className="text-body font-bold tabular-nums">{course.totalMockTests}</span>
                </div>
                <p className="text-caption text-ink-secondary mt-0.5">Mock Tests</p>
              </div>
            </div>
          </>
        )}

        {/* ── Installment Schedule Unavailable Notice (§7) ───────────────── */}
        {isInstallment && !fin && (
          <div className="mt-5 border-t border-line pt-4">
            <div className="p-3.5 rounded-field bg-sand text-sand-ink border border-amber-300 text-xs font-semibold flex items-center gap-2">
              <WarningCircle className="h-4 w-4 shrink-0 text-amber-800" weight="fill" />
              <span>{course.scheduleError || 'Installment schedule details are temporarily unavailable. Please refresh.'}</span>
            </div>
          </div>
        )}

        {/* ── Financial Summary Ribbon (Installment Courses Only — §5, §6) ───── */}
        {isInstallment && fin && (
          <div className="mt-5 border-t border-line pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-caption font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="h-4 w-4 text-brand" weight="duotone" />
                <span>Financial Summary</span>
              </span>

              {fin.requiresAdminReview ? (
                <span className="inline-flex items-center gap-1 text-caption font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                  <WarningCircle className="h-3 w-3" weight="fill" />
                  Under Review
                </span>
              ) : fin.hasStatusDiscrepancy && course.agreement?.agreement_status === 'completed' ? (
                <span className="inline-flex items-center gap-1 text-caption font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                  <WarningCircle className="h-3 w-3" weight="fill" />
                  Reconciliation Pending
                </span>
              ) : fin.hasArrears ? (
                <span className="inline-flex items-center gap-1 text-caption font-bold text-amber-700 bg-sand px-2 py-0.5 rounded-full border border-amber-300">
                  <WarningCircle className="h-3 w-3" weight="fill" />
                  Overdue Payment Pending
                </span>
              ) : null}
            </div>

            {/* Status Discrepancy Notice Banner */}
            {fin.hasStatusDiscrepancy && fin.statusDiscrepancyNotice && (
              <div className="p-3 rounded-field bg-amber-50/90 border border-amber-300 text-amber-900 text-xs flex items-start gap-2">
                <WarningCircle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" weight="fill" />
                <span className="leading-relaxed font-medium">{fin.statusDiscrepancyNotice}</span>
              </div>
            )}

            {/* Compact 2x2 on Mobile, 4-column on sm+ */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-field bg-paper border border-line p-2.5 text-center">
                <span className="text-[11px] font-semibold text-ink-secondary block uppercase tracking-wider">
                  Total Fee
                </span>
                <strong className="text-sm sm:text-base font-extrabold text-ink tabular-nums block mt-0.5">
                  {formatCoursePrice(fin.totalFee, 'INR')}
                </strong>
              </div>

              <div className="rounded-field bg-mint-tint border border-emerald-200 p-2.5 text-center">
                <span className="text-[11px] font-semibold text-mint-ink block uppercase tracking-wider">
                  Paid
                </span>
                <strong className="text-sm sm:text-base font-extrabold text-mint-ink tabular-nums block mt-0.5">
                  {formatCoursePrice(fin.totalPaid, 'INR')}
                </strong>
              </div>

              <div className="rounded-field bg-paper border border-line p-2.5 text-center">
                <span className="text-[11px] font-semibold text-ink-secondary block uppercase tracking-wider">
                  Outstanding
                </span>
                <strong className="text-sm sm:text-base font-extrabold text-ink tabular-nums block mt-0.5">
                  {formatCoursePrice(fin.outstandingBalance, 'INR')}
                </strong>
              </div>

              <div
                className={`rounded-field border p-2.5 text-center ${
                  fin.overdueBalance > 0
                    ? 'bg-red-50 border-red-300 text-red-900'
                    : 'bg-paper border-line text-ink'
                }`}
              >
                <span
                  className={`text-[11px] font-semibold block uppercase tracking-wider ${
                    fin.overdueBalance > 0 ? 'text-red-700' : 'text-ink-secondary'
                  }`}
                >
                  Overdue
                </span>
                <strong
                  className={`text-sm sm:text-base font-extrabold tabular-nums block mt-0.5 ${
                    fin.overdueBalance > 0 ? 'text-red-700' : 'text-ink'
                  }`}
                >
                  {formatCoursePrice(fin.overdueBalance, 'INR')}
                </strong>
              </div>
            </div>

            {/* Next Installment Banner */}
            {fin.requiresAdminReview ? (
              <div className="p-3 rounded-field bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center gap-2 font-medium">
                <WarningCircle className="h-4 w-4 shrink-0 text-amber-700" weight="fill" />
                <span>Agreement is under administrative review. Online payments are temporarily on hold.</span>
              </div>
            ) : fin.nextMilestone ? (
              <div
                className={`p-3 rounded-field border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                  fin.nextMilestone.isReversed
                    ? 'bg-amber-50/90 border-amber-300 text-amber-900'
                    : fin.nextMilestone.isOverdue
                    ? 'bg-red-50/80 border-red-300 text-red-900'
                    : fin.nextMilestone.isDueToday
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-paper border-line text-ink'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 font-bold">
                    <span>
                      Next Installment: #{fin.nextMilestone.installmentIndex} — {formatCoursePrice(fin.nextMilestone.remainingAmount, 'INR')}
                    </span>
                    {fin.nextMilestone.isReversed ? (
                      <span className="text-[10px] font-black uppercase tracking-wider bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded">
                        REVERSAL RESOLUTION REQUIRED
                      </span>
                    ) : fin.nextMilestone.isOverdue ? (
                      <span className="text-[10px] font-black uppercase tracking-wider bg-red-200/90 text-red-900 px-1.5 py-0.5 rounded">
                        OVERDUE
                      </span>
                    ) : fin.nextMilestone.isDueToday ? (
                      <span className="text-[10px] font-black uppercase tracking-wider bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded">
                        DUE TODAY
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-ink-secondary">
                    {fin.nextMilestone.isReversed ? (
                      <span className="text-amber-800 font-medium">
                        A previous payment was reversed. Contact support or institute admin to reconcile before proceeding.
                      </span>
                    ) : (
                      <>
                        Due Date: <strong>{formatFriendlyDate(fin.nextMilestone.effectiveDueDate)}</strong>
                        {fin.nextMilestone.revisedDueDate && (
                          <span className="text-amber-700 font-medium"> (Revised)</span>
                        )}
                      </>
                    )}
                  </p>
                </div>

                {fin.nextMilestone.isPayableNow && !isExpanded && (
                  <button
                    type="button"
                    onClick={toggleSchedule}
                    className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-field bg-brand px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-brand-hover transition-colors shrink-0"
                  >
                    <CreditCard className="h-3.5 w-3.5" weight="bold" />
                    <span>Pay {formatCoursePrice(fin.nextMilestone.remainingAmount, 'INR')}</span>
                  </button>
                )}
              </div>
            ) : fin.isFullyPaid ? (
              <div className="p-2.5 rounded-field bg-mint-tint/60 border border-emerald-200 text-mint-ink text-xs flex items-center gap-1.5 font-semibold">
                <CheckCircle className="h-4 w-4 shrink-0" weight="fill" />
                <span>All scheduled installments have been settled. Access is fully active.</span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Bottom Actions Row (§6, §7) ────────────────────────────────────── */}
      <div className="mt-5 border-t border-line pt-4 space-y-3">
        <div className="flex flex-col sm:flex-row items-center gap-2.5">
          {/* Continue Learning button (when assigned) */}
          {isAssigned && (
            <Link
              href={resumeHref}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-field bg-brand px-4 py-2.5 text-body font-bold text-white shadow-xs hover:bg-brand-hover active:scale-[0.98] transition-all"
            >
              <IconPlayCircle className="h-4 w-4" />
              <span>Continue Learning</span>
            </Link>
          )}

          {/* Toggle Installment Schedule Button (§6) */}
          {isInstallment && (
            <button
              type="button"
              onClick={toggleSchedule}
              className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-field border px-4 py-2.5 text-body font-bold transition-all ${
                isExpanded
                  ? 'bg-paper border-ink text-ink hover:bg-surface'
                  : fin?.hasArrears
                  ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600 shadow-xs'
                  : !isAssigned
                  ? 'bg-brand text-white border-brand hover:bg-brand-hover shadow-xs'
                  : 'border-line bg-paper text-ink hover:bg-surface shadow-xs'
              }`}
            >
              <Receipt className="h-4 w-4" weight="bold" />
              <span>{isExpanded ? 'Hide Installment Schedule' : 'View Installment Schedule'}</span>
              {isExpanded ? <CaretUp size={16} weight="bold" /> : <CaretDown size={16} weight="bold" />}
            </button>
          )}
        </div>

        {/* ── Expandable Installment Schedule Accordion (§6) ────────────────── */}
        {isInstallment && isExpanded && (
          <div className="mt-4 pt-3 border-t border-line animate-fadeIn">
            <StudentCourseInstallmentSchedule
              courseId={course.courseId}
              courseTitle={course.title}
              currency="INR"
              initialAgreement={course.agreement}
              initialSchedule={course.schedule}
              isEmbedded={true}
              highlightOverdue={highlightOverdue}
              targetInstallmentIndex={targetInstallmentIndex}
              onPaymentSuccess={onPaymentSettled}
            />
          </div>
        )}
      </div>
    </article>
  );
};
