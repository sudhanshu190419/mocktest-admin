'use client';

import { useState } from 'react';
import { Button } from './Button';
import { Card } from './Card';
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
        {mode === 'subscription' && plans.length > 0 && (
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
            {mode === 'purchase'
              ? 'One-time purchase'
              : selectedPlan
              ? `${cycleLabels[selectedPlan.billingCycle] || selectedPlan.name} plan price`
              : 'No subscription plans'}
          </span>
          <div>
            <strong className="tabular-nums">{formatPrice(price)}</strong>
            {mode === 'purchase' && price < course.originalPrice && (
              <del className="tabular-nums">{formatPrice(course.originalPrice)}</del>
            )}
          </div>
          <p>
            {mode === 'purchase'
              ? 'Permanent course ownership. One payment.'
              : 'Access to this course for the selected period.'}
          </p>
        </div>
        <Button
          className="store-enroll-button"
          onClick={() => setPaymentModalOpen(true)}
          disabled={!canPreview}
        >
          Enroll in {mode === 'purchase' ? 'course' : 'plan'} <span aria-hidden="true">↗</span>
        </Button>
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

