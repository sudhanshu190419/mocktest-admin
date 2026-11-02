'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Calendar,
  CreditCard,
  CheckCircle,
  WarningCircle,
  Clock,
  ArrowsClockwise,
  ShieldCheck,
  Receipt,
  Sparkle,
} from '@phosphor-icons/react';
import { supabase } from '@/config/supabase';
import { useAuth } from '@/context/AuthContext';
import { resolveStudentId } from '@/services/paymentService';
import { formatCoursePrice } from '@/services/courseCatalogService';
import { PaymentModal } from '@/components/marketing/PaymentModal';
import {
  calculateDynamicInstallmentMetrics,
  type InstallmentScheduleItem,
  type StudentCourseAgreement,
} from '@/services/student/studentCourseWebService';

export type { InstallmentScheduleItem, StudentCourseAgreement };

export interface StudentCourseInstallmentScheduleProps {
  courseId: string;
  courseTitle: string;
  currency?: string;
  initialAgreement?: StudentCourseAgreement | null;
  initialSchedule?: InstallmentScheduleItem[];
  isEmbedded?: boolean;
  highlightOverdue?: boolean;
  targetInstallmentIndex?: number | null;
  onPaymentSuccess?: () => void;
}

export function StudentCourseInstallmentSchedule({
  courseId,
  courseTitle,
  currency = 'INR',
  initialAgreement,
  initialSchedule,
  isEmbedded = false,
  highlightOverdue = false,
  targetInstallmentIndex,
  onPaymentSuccess,
}: StudentCourseInstallmentScheduleProps) {
  const { user } = useAuth();
  const [agreement, setAgreement] = useState<StudentCourseAgreement | null>(
    initialAgreement !== undefined ? initialAgreement : null
  );
  const [schedule, setSchedule] = useState<InstallmentScheduleItem[]>(
    initialSchedule !== undefined ? initialSchedule : []
  );
  const [loading, setLoading] = useState<boolean>(
    initialAgreement === undefined
  );
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync props if passed
  useEffect(() => {
    if (initialAgreement !== undefined) {
      setAgreement(initialAgreement);
      setLoading(false);
    }
  }, [initialAgreement]);

  useEffect(() => {
    if (initialSchedule !== undefined) {
      setSchedule(initialSchedule);
    }
  }, [initialSchedule]);

  // Payment Modal state for paying an eligible milestone
  const [selectedMilestone, setSelectedMilestone] = useState<InstallmentScheduleItem | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState<boolean>(false);

  const loadInstallmentData = useCallback(async () => {
    if (!user) return;
    setError(null);

    try {
      const studentId = await resolveStudentId(user.id);

      // 1. Fetch student course agreement
      const { data: agrData, error: agrErr } = await supabase
        .from('student_course_agreements')
        .select('*')
        .eq('student_id', studentId)
        .eq('course_id', courseId)
        .in('agreement_status', [
          'active',
          'in_arrears',
          'completed',
        ])
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (agrErr) {
        throw new Error(`Failed to load agreement: ${agrErr.message}`);
      }

      if (!agrData) {
        setAgreement(null);
        setSchedule([]);
        setLoading(false);
        return;
      }

      const parsedAgr: StudentCourseAgreement = {
        agreement_id: agrData.agreement_id,
        student_id: agrData.student_id,
        course_id: agrData.course_id,
        plan_id: agrData.plan_id,
        agreement_date: agrData.agreement_date,
        total_fee: Number(agrData.total_fee) || 0,
        outstanding_balance: Number(agrData.outstanding_balance) || 0,
        overdue_balance: Number(agrData.overdue_balance) || 0,
        requires_admin_review: Boolean(agrData.requires_admin_review),
        agreement_status: agrData.agreement_status,
        created_at: agrData.created_at,
      };

      setAgreement(parsedAgr);

      // 2. Fetch installment schedule for this agreement
      const { data: schedData, error: schedErr } = await supabase
        .from('student_installment_schedule')
        .select('*')
        .eq('agreement_id', agrData.agreement_id)
        .order('installment_index', { ascending: true });

      if (schedErr) {
        throw new Error(`Failed to load installment schedule: ${schedErr.message}`);
      }

      const parsedSched = (schedData || []).map((row: any) => ({
        schedule_id: row.schedule_id,
        agreement_id: row.agreement_id,
        installment_index: row.installment_index,
        due_date: row.due_date,
        revised_due_date: row.revised_due_date || null,
        amount_due: Number(row.amount_due) || 0,
        amount_paid: Number(row.amount_paid) || 0,
        waiver_amount: Number(row.waiver_amount) || 0,
        status: row.status,
        paid_at: row.paid_at || null,
        payment_id: row.payment_id || null,
      }));

      setSchedule(parsedSched as InstallmentScheduleItem[]);
    } catch (err: any) {
      console.error('[StudentCourseInstallmentSchedule] load error:', err);
      setError(err?.message || 'Failed to load installment details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, courseId]);

  useEffect(() => {
    // Only auto-fetch if initialAgreement was not provided
    if (initialAgreement === undefined) {
      loadInstallmentData();
    }
  }, [initialAgreement, loadInstallmentData]);

  const handleManualRefresh = () => {
    setRefreshing(true);
    loadInstallmentData();
  };

  // Authoritative dynamic financial calculation matching centralized hub and Migration 239 (§3, §4, §5, §6)
  const dynamicMetrics = useMemo(() => {
    if (!agreement) return null;
    return calculateDynamicInstallmentMetrics(agreement, schedule);
  }, [agreement, schedule]);

  const nextEligibleMilestone = useMemo(() => {
    if (!dynamicMetrics?.nextMilestone) return null;
    return (
      schedule.find(
        (s) => s.installment_index === dynamicMetrics.nextMilestone?.installmentIndex
      ) || null
    );
  }, [dynamicMetrics, schedule]);

  // Today in YYYY-MM-DD
  const todayStr = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }, []);

  if (loading) {
    return (
      <div className="p-4 rounded-field bg-paper/60 border border-line animate-pulse flex items-center justify-center gap-2 text-ink-secondary text-xs">
        <ArrowsClockwise className="h-4 w-4 animate-spin" />
        <span>Loading installment schedule...</span>
      </div>
    );
  }

  // If no agreement exists for this course, don't render anything
  if (!agreement) {
    return null;
  }

  const isCompleted =
    dynamicMetrics ? dynamicMetrics.isFullyPaid : agreement.agreement_status === 'completed';
  const isInArrears =
    dynamicMetrics ? dynamicMetrics.hasArrears : (agreement.agreement_status === 'in_arrears' && agreement.overdue_balance > 0);
  const isUnderReview =
    dynamicMetrics ? dynamicMetrics.requiresAdminReview : agreement.requires_admin_review;
  const hasDiscrepancy =
    dynamicMetrics?.hasStatusDiscrepancy || false;
  const totalPaid =
    dynamicMetrics ? dynamicMetrics.totalPaid : schedule.reduce((sum, item) => sum + (Number(item.amount_paid) || 0), 0);

  return (
    <>
      <section
        className={`space-y-4 ${
          isEmbedded
            ? 'pt-2'
            : 'rounded-card border border-line bg-surface p-6 sm:p-7 shadow-card'
        }`}
      >
        {/* Header (full on standalone, streamlined on embedded) */}
        {!isEmbedded ? (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-brand" weight="duotone" />
                <h2 className="text-xl sm:text-h2 font-extrabold text-ink tracking-tight">
                  Installment Payment Schedule
                </h2>
              </div>
              <p className="text-body text-ink-secondary">
                Track your scheduled payments, due dates, and settle upcoming milestone installments.
              </p>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              {isCompleted ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-mint-tint px-3 py-1 text-caption font-bold text-mint-ink border border-emerald-200">
                  <CheckCircle className="h-3.5 w-3.5" weight="fill" />
                  Agreement Fully Paid
                </span>
              ) : isUnderReview ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-caption font-bold text-amber-800 border border-amber-300">
                  <WarningCircle className="h-3.5 w-3.5" weight="fill" />
                  Under Review
                </span>
              ) : hasDiscrepancy && agreement.agreement_status === 'completed' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-caption font-bold text-amber-900 border border-amber-300">
                  <WarningCircle className="h-3.5 w-3.5" weight="fill" />
                  Reconciliation Pending
                </span>
              ) : isInArrears ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sand px-3 py-1 text-caption font-bold text-sand-ink border border-amber-300">
                  <WarningCircle className="h-3.5 w-3.5" weight="fill" />
                  Installment In Arrears
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-tint px-3 py-1 text-caption font-bold text-brand border border-blue-200">
                  <ShieldCheck className="h-3.5 w-3.5" weight="fill" />
                  Active Agreement
                </span>
              )}

              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={refreshing}
                title="Refresh installment schedule"
                className="p-1.5 text-ink-secondary hover:text-ink rounded-field hover:bg-paper border border-line transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              >
                <ArrowsClockwise className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-line">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-brand" weight="duotone" />
              <h4 className="text-sm font-bold text-ink">
                Scheduled Milestones & Payment Allocation
              </h4>
            </div>
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshing}
              title="Refresh schedule"
              className="inline-flex items-center gap-1 text-xs text-ink-secondary hover:text-brand px-2 py-1 rounded-field hover:bg-paper transition-colors min-h-[36px]"
            >
              <ArrowsClockwise className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        )}

        {error && (
          <div className="p-3.5 rounded-field bg-sand text-sand-ink border border-amber-300 text-xs font-semibold flex items-center gap-2">
            <WarningCircle className="h-4 w-4 shrink-0" weight="fill" />
            <span>{error}</span>
          </div>
        )}

        {/* Administrative Review Notice (§6) */}
        {isUnderReview && (
          <div className="p-3.5 rounded-field bg-amber-50 border border-amber-300 text-amber-900 text-xs font-medium space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-800">
              <WarningCircle className="h-4 w-4 shrink-0" weight="fill" />
              <span>Agreement Under Administrative Review</span>
            </div>
            <p className="text-[11px] text-amber-800/90 leading-relaxed">
              This installment agreement is currently pending administrative review. Subsequent installment checkout and online payments are temporarily on hold. Please contact institute administration for assistance.
            </p>
          </div>
        )}

        {/* Data Consistency Discrepancy Notice (§1) */}
        {hasDiscrepancy && dynamicMetrics?.statusDiscrepancyNotice && (
          <div className="p-3.5 rounded-field bg-amber-50/80 border border-amber-300 text-amber-900 text-xs font-medium space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-800">
              <WarningCircle className="h-4 w-4 shrink-0" weight="fill" />
              <span>Data Consistency Notice</span>
            </div>
            <p className="text-[11px] text-amber-800/90 leading-relaxed">
              {dynamicMetrics.statusDiscrepancyNotice}
            </p>
          </div>
        )}

        {/* Financial Metrics Summary Banner (rendered only on standalone detail page - uses dynamic metrics §6) */}
        {!isEmbedded && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <div className="rounded-field bg-paper border border-line p-3 sm:p-4 text-center">
              <span className="text-caption font-bold text-ink-secondary uppercase tracking-wider block">
                Total Course Fee
              </span>
              <strong className="text-lg sm:text-xl font-extrabold text-ink tabular-nums mt-0.5 block">
                {formatCoursePrice(dynamicMetrics?.totalFee ?? agreement.total_fee, currency)}
              </strong>
            </div>

            <div className="rounded-field bg-mint-tint border border-emerald-200 p-3 sm:p-4 text-center">
              <span className="text-caption font-bold text-mint-ink uppercase tracking-wider block">
                Total Paid to Date
              </span>
              <strong className="text-lg sm:text-xl font-extrabold text-mint-ink tabular-nums mt-0.5 block">
                {formatCoursePrice(totalPaid, currency)}
              </strong>
            </div>

            <div className="rounded-field bg-paper border border-line p-3 sm:p-4 text-center">
              <span className="text-caption font-bold text-ink-secondary uppercase tracking-wider block">
                Outstanding Balance
              </span>
              <strong className="text-lg sm:text-xl font-extrabold text-ink tabular-nums mt-0.5 block">
                {formatCoursePrice(dynamicMetrics?.outstandingBalance ?? agreement.outstanding_balance, currency)}
              </strong>
            </div>

            <div
              className={`rounded-field border p-3 sm:p-4 text-center ${
                (dynamicMetrics?.overdueBalance ?? agreement.overdue_balance) > 0
                  ? 'bg-red-50 border-red-300 text-red-900'
                  : 'bg-paper border-line text-ink'
              }`}
            >
              <span
                className={`text-caption font-bold uppercase tracking-wider block ${
                  (dynamicMetrics?.overdueBalance ?? agreement.overdue_balance) > 0 ? 'text-red-700' : 'text-ink-secondary'
                }`}
              >
                Overdue Balance
              </span>
              <strong
                className={`text-lg sm:text-xl font-extrabold tabular-nums mt-0.5 block ${
                  (dynamicMetrics?.overdueBalance ?? agreement.overdue_balance) > 0 ? 'text-red-700' : 'text-ink'
                }`}
              >
                {formatCoursePrice(dynamicMetrics?.overdueBalance ?? agreement.overdue_balance, currency)}
              </strong>
            </div>
          </div>
        )}

        {/* Installment Schedule Breakdown */}
        <div className="space-y-3">
          {!isEmbedded && (
            <h3 className="text-sm font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
              <CreditCard className="h-4 w-4 text-brand" weight="duotone" />
              <span>Scheduled Milestone Payments</span>
            </h3>
          )}

          <div className="space-y-2.5">
            {schedule.map((item) => {
              const effectiveDueDate = item.revised_due_date || item.due_date;
              const isPaid = item.status === 'paid';
              const isWaived = item.status === 'waived';
              const isReversed = item.status === 'payment_reversed';
              const remainingPayable = Math.max(
                0,
                item.amount_due - item.amount_paid - item.waiver_amount
              );
              const isPartiallyPaid = !isPaid && !isWaived && item.amount_paid > 0 && remainingPayable > 0;

              // Migration 239 authoritative rule: Due date itself is an access day.
              // Overdue begins strictly on subsequent calendar day if unpaid.
              // Stale status='overdue' does NOT override a valid future revised_due_date (§3).
              const isOverdue =
                !isPaid &&
                !isWaived &&
                remainingPayable > 0 &&
                effectiveDueDate < todayStr;
              const isDueToday =
                !isPaid && !isWaived && remainingPayable > 0 && effectiveDueDate === todayStr;

              const isNext = dynamicMetrics?.nextMilestone?.installmentIndex === item.installment_index;

              // Immediate payment eligibility: earliest unpaid milestone, arrived/overdue, NOT under admin review, and NOT payment_reversed (§1, §2, §5, §6)
              const isPayableNow =
                isNext &&
                (isOverdue || isDueToday || effectiveDueDate <= todayStr) &&
                !isUnderReview &&
                !isReversed;

              // Highlight target installment (deep-link arrival or active overdue)
              const isTargetHighlighted =
                highlightOverdue &&
                (targetInstallmentIndex
                  ? item.installment_index === targetInstallmentIndex
                  : isOverdue || isNext);

              return (
                <div
                  key={item.schedule_id}
                  id={`installment-row-${courseId}-${item.installment_index}`}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-field border transition-all ${
                    isTargetHighlighted
                      ? 'bg-amber-50/70 border-amber-400 ring-2 ring-amber-300 shadow-sm animate-pulse'
                      : isPaid
                      ? 'bg-paper/40 border-line text-ink-secondary'
                      : isPayableNow
                      ? 'bg-surface border-brand ring-1 ring-brand/30 shadow-xs'
                      : 'bg-surface border-line text-ink'
                  }`}
                >
                  {/* Left: Sequence Number & Status Pill */}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-ink text-sm sm:text-base">
                        Installment #{item.installment_index}
                      </span>

                      {isPaid ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-mint-tint px-2.5 py-0.5 text-caption font-bold text-mint-ink border border-emerald-200">
                          <CheckCircle className="h-3 w-3" weight="fill" />
                          Paid
                        </span>
                      ) : isPartiallyPaid ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-tint px-2.5 py-0.5 text-caption font-bold text-brand border border-blue-200">
                          <Clock className="h-3 w-3" weight="fill" />
                          Partially Paid
                        </span>
                      ) : isWaived ? (
                        <span className="inline-flex items-center rounded-full bg-paper px-2.5 py-0.5 text-caption font-bold text-ink-secondary border border-line">
                          Waived
                        </span>
                      ) : isReversed ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-caption font-bold text-rose-800 border border-rose-200">
                          <ArrowsClockwise className="h-3 w-3" weight="bold" />
                          Payment Reversed
                        </span>
                      ) : isOverdue ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2.5 py-0.5 text-caption font-bold text-sand-ink border border-amber-300">
                          <WarningCircle className="h-3 w-3" weight="fill" />
                          Overdue
                        </span>
                      ) : isDueToday ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-caption font-bold text-amber-800 border border-amber-200">
                          <Clock className="h-3 w-3" weight="fill" />
                          Due Today
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-paper px-2.5 py-0.5 text-caption font-semibold text-ink-secondary border border-line">
                          Upcoming
                        </span>
                      )}

                      {isTargetHighlighted && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded-full">
                          <Sparkle className="h-3 w-3" weight="fill" />
                          Action Required
                        </span>
                      )}
                    </div>

                    {/* Due Date Context */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-secondary">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-ink-muted" weight="duotone" />
                      <span>
                        Due Date: <strong className="text-ink font-semibold">{effectiveDueDate}</strong>
                      </span>
                      {item.revised_due_date && (
                        <span className="text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 font-medium">
                          (Revised from {item.due_date})
                        </span>
                      )}
                      {item.paid_at && (
                        <span className="text-ink-muted">
                          • Settled {new Date(item.paid_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle / Right: Financial Details & Action Button */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between sm:justify-end gap-3 sm:gap-6 pt-2 sm:pt-0 border-t sm:border-t-0 border-line">
                    <div className="text-left sm:text-right">
                      <span className="text-caption text-ink-secondary block">Amount Due</span>
                      <strong className="text-base sm:text-lg font-bold text-ink tabular-nums block">
                        {formatCoursePrice(item.amount_due, currency)}
                      </strong>
                      {isPaid && item.amount_paid > 0 ? (
                        <span className="text-caption text-emerald-700 block">
                          Paid: {formatCoursePrice(item.amount_paid, currency)}
                        </span>
                      ) : isPartiallyPaid ? (
                        <span className="text-caption text-amber-700 block">
                          Paid: {formatCoursePrice(item.amount_paid, currency)} • Remaining: {formatCoursePrice(remainingPayable, currency)}
                        </span>
                      ) : null}
                    </div>

                    <div className="min-w-[140px] text-right">
                      {isPaid ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 py-2">
                          <CheckCircle className="h-4 w-4" weight="fill" />
                          Settled
                        </span>
                      ) : isWaived ? (
                        <span className="text-xs font-bold text-ink-secondary py-2">
                          Waived
                        </span>
                      ) : isPayableNow ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedMilestone(item);
                            setIsPaymentModalOpen(true);
                          }}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-field bg-brand px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-brand-hover active:scale-[0.98] transition-all w-full sm:w-auto"
                        >
                          <CreditCard className="h-4 w-4" weight="bold" />
                          <span>Pay {formatCoursePrice(remainingPayable, currency)}</span>
                        </button>
                      ) : isNext && isReversed ? (
                        <button
                          type="button"
                          disabled
                          className="inline-flex min-h-[44px] items-center justify-center rounded-field bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 border border-rose-300 cursor-not-allowed w-full sm:w-auto"
                          title="This milestone has a reversed payment. Contact administration to re-enable payment."
                        >
                          Reversal Resolution Required
                        </button>
                      ) : isNext && isUnderReview ? (
                        <button
                          type="button"
                          disabled
                          className="inline-flex min-h-[44px] items-center justify-center rounded-field bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 border border-amber-300 cursor-not-allowed w-full sm:w-auto"
                          title="Checkout is paused while agreement is under administrative review."
                        >
                          Review Pending
                        </button>
                      ) : isNext ? (
                        <button
                          type="button"
                          disabled
                          className="inline-flex min-h-[44px] items-center justify-center rounded-field bg-paper px-3 py-2 text-xs font-semibold text-ink-muted border border-line cursor-not-allowed w-full sm:w-auto"
                          title="Payment opens when the milestone due date arrives."
                        >
                          Due on {effectiveDueDate}
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="inline-flex min-h-[44px] items-center justify-center rounded-field bg-paper px-3 py-2 text-xs font-semibold text-ink-muted border border-line cursor-not-allowed w-full sm:w-auto"
                          title="Installments must be settled in chronological sequence."
                        >
                          Pay #{dynamicMetrics?.nextMilestone?.installmentIndex ?? 1} First
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Informative Footer Note */}
        <div className="p-3 rounded-field bg-paper border border-line text-[11px] text-ink-secondary leading-relaxed">
          <p>
            <strong>Note on Installments:</strong> Payments are allocated strictly in sequence (FIFO) to clear pending milestones. Each successful payment immediately extends your learning access and updates your outstanding course balance.
          </p>
        </div>
      </section>

      {/* Payment Modal for Subsequent Installment Checkout */}
      {selectedMilestone && agreement && (
        <PaymentModal
          isOpen={isPaymentModalOpen}
          onClose={() => {
            setIsPaymentModalOpen(false);
            setSelectedMilestone(null);
          }}
          itemType="course"
          itemId={courseId}
          itemTitle={courseTitle}
          streamName="MakeMeTopper Installment Plan"
          price={Math.max(
            0,
            selectedMilestone.amount_due -
              selectedMilestone.amount_paid -
              selectedMilestone.waiver_amount
          )}
          currency={currency}
          paymentMode="installment"
          agreementId={agreement.agreement_id}
          installmentIndex={selectedMilestone.installment_index}
          accessDurationLabel={`Installment #${selectedMilestone.installment_index} Payment`}
          onSuccess={() => {
            handleManualRefresh();
            onPaymentSuccess?.();
          }}
        />
      )}
    </>
  );
}
