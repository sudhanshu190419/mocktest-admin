'use client';

import { useState } from 'react';
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
import { formatCoursePrice } from '@/services/courseCatalogService';
import { PaymentModal } from './PaymentModal';
import type { Course } from '@/types/courseCatalog';

const cycleLabels: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Annual',
};

export function CoursePricing({ course }: { course: Course }) {
  const { user } = useAuth();
  const profileId = user?.id ?? null;

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

  const plans = course.plans.filter((plan) => plan.isActive);
  const [mode, setMode] = useState<'purchase' | 'subscription'>('purchase');
  const [planId, setPlanId] = useState(
    plans.find((plan) => plan.isFeatured)?.planId ?? plans[0]?.planId ?? ''
  );
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  const selectedPlan = plans.find((plan) => plan.planId === planId);
  const price =
    mode === 'purchase'
      ? course.discountedPrice ?? course.originalPrice
      : selectedPlan?.price ?? 0;
  const currency =
    mode === 'purchase' ? course.currency : selectedPlan?.currencyCode ?? course.currency;
  const canPreview = mode === 'purchase' || Boolean(selectedPlan);
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

        {isEnrolled ? (
          <div className="p-4 rounded-field bg-emerald-50 border border-emerald-200 text-emerald-900 my-4">
            <span className="text-caption font-extrabold uppercase tracking-wide text-emerald-700">Access Granted</span>
            <p className="text-xs font-bold text-emerald-950 mt-0.5">
              You are currently enrolled in this course batch.
            </p>
          </div>
        ) : (
          <div className="store-payment-toggle" role="group" aria-label="Payment type">
            <button onClick={() => setMode('purchase')} aria-pressed={mode === 'purchase'}>
              Buy full course
            </button>
            <button
              onClick={() => setMode('subscription')}
              aria-pressed={mode === 'subscription'}
              disabled={plans.length === 0}
            >
              Subscribe
            </button>
          </div>
        )}

        {!isEnrolled && mode === 'subscription' && plans.length > 0 && (
          <fieldset className="store-plan-options">
            <legend className="sr-only">Choose subscription duration</legend>
            {plans.map((plan) => (
              <label key={plan.planId} className={planId === plan.planId ? 'selected' : ''}>
                <input
                  type="radio"
                  name={`plan-${course.courseId}`}
                  checked={planId === plan.planId}
                  onChange={() => setPlanId(plan.planId)}
                />
                <span>
                  <b>{cycleLabels[plan.billingCycle] || plan.name}</b>
                  <small className="tabular-nums">{plan.durationDays} days of access</small>
                </span>
                <strong className="tabular-nums">
                  {formatCoursePrice(plan.price, plan.currencyCode)}
                </strong>
                {plan.isFeatured && <em>Featured</em>}
              </label>
            ))}
          </fieldset>
        )}

        <div className="store-price-display">
          <span className="store-small-label">
            {isEnrolled
              ? 'Enrollment Status'
              : mode === 'purchase'
              ? 'One-time purchase'
              : selectedPlan
              ? `${cycleLabels[selectedPlan.billingCycle] || selectedPlan.name} plan price`
              : 'No subscription plans'}
          </span>
          <div>
            {isEnrolled ? (
              <strong className="text-emerald-700">Active Access</strong>
            ) : (
              <>
                <strong className="tabular-nums">{formatPrice(price)}</strong>
                {mode === 'purchase' && price < course.originalPrice && (
                  <del className="tabular-nums">{formatPrice(course.originalPrice)}</del>
                )}
              </>
            )}
          </div>
          <p>
            {isEnrolled
              ? 'You have active access to all lessons, live classes, and chapter tests.'
              : mode === 'purchase'
              ? 'Permanent course ownership. One payment.'
              : 'Access to this course for the selected period.'}
          </p>
        </div>

        {isEnrolled ? (
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
            Enroll in {mode === 'purchase' ? 'course' : 'plan'} <span aria-hidden="true">↗</span>
          </Button>
        )}

        <div className="store-included">
          <h3>{mode === 'purchase' ? 'Your learning essentials' : 'Included with this plan'}</h3>
          <ul>
            {(mode === 'subscription'
              ? selectedPlan?.features.map((feature) => feature.displayName) ?? []
              : [
                  'Live-class learning',
                  'Class recordings for revision',
                  'Subject-wise PDF notes',
                  'Full test series & evaluation',
                  'Permanent course ownership',
                ]
            ).map((feature) => (
              <li key={feature}>
                <span aria-hidden="true">✓</span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {isEnrolled ? (
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
              {formatPrice(course.discountedPrice ?? course.originalPrice)}
            </strong>
          </span>
          <b>Enroll now ↑</b>
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
        planId={mode === 'subscription' ? selectedPlan?.planId : undefined}
        planName={
          mode === 'subscription'
            ? `${cycleLabels[selectedPlan?.billingCycle || ''] || selectedPlan?.name || 'Subscription'} Plan`
            : 'Full Course (Permanent)'
        }
        accessDurationLabel={
          mode === 'purchase'
            ? 'Permanent Lifetime Ownership'
            : `${selectedPlan?.durationDays ?? 30} Days Active Access`
        }
      />
    </>
  );
}


