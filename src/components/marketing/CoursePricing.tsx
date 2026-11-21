'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { Button } from './Button';
import { Card } from './Card';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import {
  fetchStudentBootstrap,
  studentDashboardKeys,
  type StudentEnrolledCourse,
} from '@/services/student/studentDashboardWebService';
import {
  formatCoursePrice,
  calculateInstallmentSchedule,
  fetchActiveCourseInstallmentPlans,
} from '@/services/courseCatalogService';
import { PaymentModal } from './PaymentModal';
import type { Course, CourseInstallmentPlan } from '@/types/courseCatalog';
import { supabase } from '@/config/supabase';
import { resolveStudentId } from '@/services/paymentService';

export function CoursePricing({ course }: { course: Course }) {
  const { user } = useAuth();
  const profileId = user?.id ?? null;

  // 1. Enrollment status via student dashboard bootstrap
  const { data: bootstrapResult } = useQuery({
    queryKey: studentDashboardKeys.bootstrap(profileId),
    queryFn: () => fetchStudentBootstrap(),
    enabled: !!profileId,
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const enrolledCourses: StudentEnrolledCourse[] = bootstrapResult?.data?.enrolled_courses || [];
  const isEnrolled = enrolledCourses.some((c) => c.course_id === course.courseId);

  // 2. Active installment plans (from props and client-side refresh)
  const { data: fetchedInstallmentPlans } = useQuery({
    queryKey: ['course-installment-plans', course.courseId],
    queryFn: () => fetchActiveCourseInstallmentPlans(course.courseId),
    staleTime: 60_000,
  });

  const activeInstallmentPlans: CourseInstallmentPlan[] = useMemo(() => {
    const combined = fetchedInstallmentPlans ?? course.installmentPlans ?? [];
    return combined.filter((p) => p.isActive);
  }, [fetchedInstallmentPlans, course.installmentPlans]);

  // 3. Existing student course agreement status (if authenticated)
  const { data: agreementData } = useQuery({
    queryKey: ['student-course-agreement', profileId, course.courseId],
    queryFn: async () => {
      if (!profileId) return null;
      try {
        const studentId = await resolveStudentId(profileId);
        const { data, error } = await supabase
          .from('student_course_agreements')
          .select('agreement_id, agreement_status, total_fee, outstanding_balance, overdue_balance, agreement_date, plan_id')
          .eq('student_id', studentId)
          .eq('course_id', course.courseId)
          .order('created_at', { ascending: false })
          .maybeSingle();

        if (error) {
          console.warn('Could not query student agreement:', error.message);
          return null;
        }
        return data;
      } catch (err) {
        console.warn('Error querying student agreement:', err);
        return null;
      }
    },
    enabled: !!profileId,
    staleTime: 30_000,
  });

  const hasActiveAgreement =
    agreementData?.agreement_status === 'active' || agreementData?.agreement_status === 'completed';
  const isAgreementPending = agreementData?.agreement_status === 'pending_initial_payment';
  const isAgreementInArrears = agreementData?.agreement_status === 'in_arrears';

  // 4. Payment Options: Buy full course | Pay in Installments (Subscriptions removed)
  const [mode, setMode] = useState<'purchase' | 'installment'>('purchase');
  const [installmentPlanId, setInstallmentPlanId] = useState(
    activeInstallmentPlans[0]?.planId ?? ''
  );

  // Synchronize installmentPlanId when active plans load
  useEffect(() => {
    if (activeInstallmentPlans.length > 0 && !activeInstallmentPlans.some((p) => p.planId === installmentPlanId)) {
      setInstallmentPlanId(activeInstallmentPlans[0].planId);
    }
  }, [activeInstallmentPlans, installmentPlanId]);

  // If currently in installment mode but no active plans exist, safely revert to purchase
  useEffect(() => {
    if (mode === 'installment' && activeInstallmentPlans.length === 0) {
      setMode('purchase');
    }
  }, [mode, activeInstallmentPlans.length]);

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const selectedInstallmentPlan =
    activeInstallmentPlans.find((plan) => plan.planId === installmentPlanId) ?? activeInstallmentPlans[0];

  // Exact remainder-absorbing installment calculation
  const installmentSchedule = useMemo(() => {
    if (!selectedInstallmentPlan) return null;
    return calculateInstallmentSchedule(
      selectedInstallmentPlan.totalFee,
      selectedInstallmentPlan.numberOfInstallments,
      selectedInstallmentPlan.intervalMonths
    );
  }, [selectedInstallmentPlan]);

  const initialTrancheAmount = installmentSchedule?.schedule[0]?.amount ?? selectedInstallmentPlan?.totalFee ?? 0;

  const price =
    mode === 'purchase'
      ? course.discountedPrice ?? course.originalPrice
      : initialTrancheAmount;

  const currency = course.currency;

  const canPreview =
    mode === 'purchase' ||
    (mode === 'installment' && Boolean(selectedInstallmentPlan));

  const formatPrice = (value: number) => formatCoursePrice(value, currency);

  return (
    <>
      <Card className="store-pricing">
        <div className="store-pricing-heading">
          <span className="store-eyebrow">MAKE YOUR NEXT MOVE</span>
          <span className="store-demo-tag">Pricing & Plans</span>
        </div>
        <h2>Your way to learn.</h2>
        <p className="store-pricing-intro">One course. Choose the access that suits you.</p>

        {isEnrolled || hasActiveAgreement ? (
          <div className="p-4 rounded-field bg-emerald-50 border border-emerald-200 text-emerald-900 my-4">
            <span className="text-caption font-extrabold uppercase tracking-wide text-emerald-700">Access Granted</span>
            <p className="text-xs font-bold text-emerald-950 mt-0.5">
              {isEnrolled
                ? 'You own full, permanent access to this course.'
                : 'You have an active installment agreement for this course.'}
            </p>
          </div>
        ) : (
          <>
            {isAgreementPending && (
              <div className="p-3.5 rounded-field bg-amber-50 border border-amber-200 text-amber-900 my-3 text-xs">
                <span className="font-bold text-amber-800">Pending Initial Payment:</span>
                <p className="mt-0.5 font-medium">
                  An installment agreement is initiated for this course. Complete your first installment payment to activate enrollment.
                </p>
              </div>
            )}

            {isAgreementInArrears && (
              <div className="p-3.5 rounded-field bg-red-50 border border-red-200 text-red-900 my-3 text-xs">
                <span className="font-bold text-red-800">Payment Overdue:</span>
                <p className="mt-0.5 font-medium">
                  Your agreement has an overdue installment of {formatCoursePrice(agreementData?.overdue_balance ?? 0, course.currency)}. Please settle your overdue balance to maintain access.
                </p>
              </div>
            )}

            {/* Payment Option Toggle: Rendered only when active installment plans exist */}
            {activeInstallmentPlans.length > 0 && (
              <div className="store-payment-toggle" role="group" aria-label="Payment type">
                <button
                  type="button"
                  onClick={() => setMode('purchase')}
                  aria-pressed={mode === 'purchase'}
                >
                  Buy full course
                </button>
                <button
                  type="button"
                  onClick={() => setMode('installment')}
                  aria-pressed={mode === 'installment'}
                >
                  Pay in Installments
                </button>
              </div>
            )}
          </>
        )}

        {/* Installment Plan Picker (rendered when multiple active installment plans exist) */}
        {!isEnrolled && !hasActiveAgreement && mode === 'installment' && activeInstallmentPlans.length > 1 && (
          <fieldset className="store-plan-options">
            <legend className="sr-only">Choose installment plan</legend>
            {activeInstallmentPlans.map((plan) => (
              <label key={plan.planId} className={installmentPlanId === plan.planId ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`installment-plan-${course.courseId}`}
                  checked={installmentPlanId === plan.planId}
                  onChange={() => setInstallmentPlanId(plan.planId)}
                />
                <span>
                  <b>{plan.planName}</b>
                  <small className="tabular-nums">
                    {plan.numberOfInstallments} installments · Every {plan.intervalMonths} mo
                  </small>
                </span>
                <strong className="tabular-nums">
                  {formatCoursePrice(plan.totalFee, course.currency)}
                </strong>
              </label>
            ))}
          </fieldset>
        )}

        {/* Installment Schedule & Details Breakdown */}
        {!isEnrolled && !hasActiveAgreement && mode === 'installment' && selectedInstallmentPlan && installmentSchedule && (
          <div className="p-3.5 rounded-card bg-paper border border-line my-3.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between font-semibold text-ink">
              <span>Installment Schedule: <b>{selectedInstallmentPlan.planName}</b></span>
              <span className="text-caption font-bold text-brand uppercase tracking-wider px-2 py-0.5 rounded bg-brand/10">
                {selectedInstallmentPlan.numberOfInstallments} Payments
              </span>
            </div>

            <div className="space-y-1.5 pt-1.5 border-t border-line text-xs">
              <div className="flex items-center justify-between">
                <span className="text-ink-secondary">
                  Installment 1 (Due today to enroll):
                </span>
                <strong className="tabular-nums text-ink text-sm">
                  {formatCoursePrice(installmentSchedule.schedule[0].amount, course.currency)}
                </strong>
              </div>

              {installmentSchedule.numberOfInstallments > 1 && (
                <div className="flex items-center justify-between">
                  <span className="text-ink-secondary">
                    Installments 2 to {installmentSchedule.numberOfInstallments} (Every {selectedInstallmentPlan.intervalMonths} mo):
                  </span>
                  <strong className="tabular-nums text-ink">
                    {installmentSchedule.hasRoundingAdjustment ? (
                      <span>
                        {formatCoursePrice(installmentSchedule.standardTranche, course.currency)}
                        <span className="text-caption text-ink-secondary font-normal"> (final {formatCoursePrice(installmentSchedule.finalTranche, course.currency)})</span>
                      </span>
                    ) : (
                      formatCoursePrice(installmentSchedule.standardTranche, course.currency)
                    )}
                  </strong>
                </div>
              )}

              <div className="flex items-center justify-between pt-1.5 border-t border-line font-bold">
                <span className="text-ink">Total Fixed Course Fee:</span>
                <span className="tabular-nums text-ink text-sm font-extrabold">
                  {formatCoursePrice(selectedInstallmentPlan.totalFee, course.currency)}
                </span>
              </div>
            </div>

            {installmentSchedule.hasRoundingAdjustment && (
              <p className="text-[11px] text-ink-secondary leading-tight italic pt-0.5">
                * Note: Final installment adjusted by ₹{Math.abs(installmentSchedule.finalTranche - installmentSchedule.standardTranche).toFixed(2)} to ensure installments total exactly {formatCoursePrice(selectedInstallmentPlan.totalFee, course.currency)}.
              </p>
            )}
          </div>
        )}

        {/* Clear Explanation for Installments */}
        {!isEnrolled && !hasActiveAgreement && mode === 'installment' && selectedInstallmentPlan && (
          <div className="store-pricing-footnote my-3">
            <span aria-hidden="true">ℹ</span>
            <p>
              Installments are separate payments towards a fixed total course fee of {formatCoursePrice(selectedInstallmentPlan.totalFee, course.currency)}. Completing your first payment immediately activates enrollment. Subsequent installments are due on schedule.
            </p>
          </div>
        )}

        {/* Price Display Block */}
        <div className="store-price-display">
          <span className="store-small-label">
            {isEnrolled || hasActiveAgreement
              ? 'Enrollment Status'
              : mode === 'purchase'
              ? 'One-time purchase'
              : selectedInstallmentPlan
              ? 'First installment due today'
              : 'No installment plans'}
          </span>
          <div>
            {isEnrolled || hasActiveAgreement ? (
              <strong className="text-emerald-700">Active Access</strong>
            ) : (
              <>
                <strong className="tabular-nums">{formatPrice(price)}</strong>
                {mode === 'purchase' && price < course.originalPrice && (
                  <del className="tabular-nums">{formatPrice(course.originalPrice)}</del>
                )}
                {mode === 'installment' && selectedInstallmentPlan && (
                  <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-paper border border-line text-ink-secondary">
                    Total: {formatCoursePrice(selectedInstallmentPlan.totalFee, course.currency)}
                  </span>
                )}
              </>
            )}
          </div>
          <p>
            {isEnrolled || hasActiveAgreement
              ? 'You have active access to all lessons, live classes, and chapter tests.'
              : mode === 'purchase'
              ? 'Permanent course ownership. One payment.'
              : selectedInstallmentPlan
              ? `Pay ${formatCoursePrice(initialTrancheAmount, course.currency)} today to activate enrollment. Remaining balance payable across ${selectedInstallmentPlan.numberOfInstallments - 1} scheduled payments.`
              : 'No active installment plans available for this course.'}
          </p>
        </div>

        {isEnrolled || hasActiveAgreement ? (
          <Link
            href={`/student/courses/${course.courseId}`}
            className="store-enroll-button inline-flex items-center justify-center text-center font-bold"
          >
            Go to Classroom <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <Button
            className="store-enroll-button"
            onClick={() => setPaymentModalOpen(true)}
            disabled={!canPreview}
          >
            {mode === 'purchase'
              ? 'Enroll in course'
              : `Pay ${formatCoursePrice(initialTrancheAmount, course.currency)} & Enroll`} <span aria-hidden="true">→</span>
          </Button>
        )}

        <div className="store-included">
          <h3>
            {mode === 'purchase'
              ? 'Your learning essentials'
              : 'Included with installment enrollment'}
          </h3>
          <ul>
            {[
              'Live-class learning',
              'Class recordings for revision',
              'Subject-wise PDF notes',
              'Full test series & evaluation',
              mode === 'purchase'
                ? 'Permanent course ownership'
                : 'Access active while installments are in good standing',
            ].map((feature) => (
              <li key={feature}>
                <span aria-hidden="true">✓</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {isEnrolled || hasActiveAgreement ? (
        <Link
          href={`/student/courses/${course.courseId}`}
          className="store-mobile-enroll"
        >
          <span>
            Status: <strong className="text-emerald-700">Enrolled</strong>
          </span>
          <b>Go to Classroom →</b>
        </Link>
      ) : (
        <a
          href="#course-pricing"
          className="store-mobile-enroll"
          onClick={(e) => {
            e.preventDefault();
            setPaymentModalOpen(true);
          }}
        >
          <span>
            From{' '}
            <strong className="tabular-nums">
              {formatPrice(
                mode === 'installment'
                  ? initialTrancheAmount
                  : (course.discountedPrice ?? course.originalPrice)
              )}
            </strong>
          </span>
          <b>Enroll now →</b>
        </a>
      )}

      {/* Unified Razorpay Payment Modal */}
      <PaymentModal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        itemType="course"
        itemId={course.courseId}
        itemTitle={course.presentation.displayTitle}
        streamName={course.streamName}
        price={price}
        originalPrice={mode === 'purchase' ? course.originalPrice : undefined}
        currency={currency}
        planName={
          mode === 'installment'
            ? `Installment Plan (${selectedInstallmentPlan?.planName || 'Fixed Term'})`
            : 'Full Course (Permanent)'
        }
        accessDurationLabel={
          mode === 'purchase'
            ? 'Permanent Lifetime Ownership'
            : `${selectedInstallmentPlan?.numberOfInstallments ?? 1} Installments (${formatCoursePrice(selectedInstallmentPlan?.totalFee ?? 0, course.currency)} Total)`
        }
        paymentMode={mode}
        installmentPlan={mode === 'installment' ? selectedInstallmentPlan : undefined}
        firstTrancheAmount={mode === 'installment' ? initialTrancheAmount : undefined}
      />
    </>
  );
}
