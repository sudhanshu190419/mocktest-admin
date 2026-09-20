'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  ShieldCheck,
  CheckCircle,
  CircleNotch,
  WarningCircle,
  LockKey,
  X,
  ArrowRight,
  HourglassMedium,
  ArrowClockwise,
} from '@phosphor-icons/react';
import {
  loadRazorpayScript,
  createPaymentOrder,
  pollCourseEnrollment,
  pollPYQEnrollment,
  resolveStudentId,
} from '@/services/paymentService';
import { formatCoursePrice } from '@/services/courseCatalogService';

export interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemType: 'course' | 'pyq';
  itemId: string;
  itemTitle: string;
  streamName: string;
  price: number;
  originalPrice?: number;
  currency?: string;
  planId?: string;
  planName?: string;
  accessDurationLabel: string;
  onSuccess?: () => void;
}

type CheckoutStatus =
  | 'idle'
  | 'initiating'
  | 'gateway_open'
  | 'verifying'
  | 'pending_grant'
  | 'success'
  | 'error';

interface RazorpayErrorResponse {
  error?: {
    description?: string;
    code?: string;
    source?: string;
    step?: string;
    reason?: string;
  };
}

export function PaymentModal({
  isOpen,
  onClose,
  itemType,
  itemId,
  itemTitle,
  streamName,
  price,
  originalPrice,
  currency = 'INR',
  planId,
  planName,
  accessDurationLabel,
  onSuccess,
}: PaymentModalProps) {
  const { user, teacherProfile } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<CheckoutStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRetryingGrant, setIsRetryingGrant] = useState(false);

  // Sync scroll lock with modal open/close
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
  const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;
  const signupUrl = `/signup?next=${encodeURIComponent(currentPath)}`;

  const handleStartPayment = async () => {
    if (!user) {
      router.push(loginUrl);
      return;
    }

    setStatus('initiating');
    setErrorMessage(null);

    try {
      // 1. Ensure Razorpay checkout script is loaded
      const scriptReady = await loadRazorpayScript();
      if (!scriptReady) {
        setStatus('error');
        setErrorMessage('Could not load secure payment gateway. Please check your internet connection.');
        return;
      }

      // 2. Resolve student_id
      const studentId = await resolveStudentId(user.id);

      // 3. Create verified Razorpay order via Edge Function
      const orderRes = await createPaymentOrder({
        courseId: itemType === 'course' ? itemId : undefined,
        packageId: itemType === 'pyq' ? itemId : undefined,
        planId: planId,
        studentId: studentId,
      });

      if (!orderRes.success || !orderRes.data) {
        setStatus('error');
        setErrorMessage(orderRes.error || 'Failed to initiate order. Please try again.');
        return;
      }

      const orderData = orderRes.data;

      // 4. Launch Razorpay Checkout Modal
      const studentName =
        teacherProfile?.name ||
        user.user_metadata?.full_name ||
        user.email?.split('@')[0] ||
        'Student';

      const studentPhone = user.phone || user.user_metadata?.phone || '';

      const rzp = new window.Razorpay({
        key: orderData.razorpayKey,
        order_id: orderData.razorpayOrderId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: 'MakeMeTopper',
        description: orderData.description || itemTitle,
        prefill: {
          name: studentName,
          email: user.email || '',
          contact: studentPhone,
        },
        theme: {
          color: 'var(--color-store-blue)', // Design A brand token
        },
        modal: {
          ondismiss: () => {
            // User closed Razorpay modal
            setStatus('idle');
          },
        },
        handler: async () => {
          // Payment captured successfully on Razorpay, poll backend for grant
          setStatus('verifying');

          const grantConfirmed =
            itemType === 'course'
              ? await pollCourseEnrollment(itemId, studentId, 45000, 2000)
              : await pollPYQEnrollment(itemId, studentId, 45000, 2000);

          if (grantConfirmed) {
            setStatus('success');
            if (onSuccess) onSuccess();

            setTimeout(() => {
              onClose();
              if (itemType === 'course') {
                router.push(`/student/courses/${itemId}`);
              } else {
                router.push('/student/tests');
              }
            }, 1800);
          } else {
            // PRD §10.4: Pending-grant honesty fix — never a false success redirect
            setStatus('pending_grant');
          }
        },
      });

      rzp.on('payment.failed', (response: RazorpayErrorResponse) => {
        setStatus('error');
        setErrorMessage(response?.error?.description || 'Payment was declined or cancelled. You have not been charged.');
      });

      setStatus('gateway_open');
      rzp.open();
    } catch (err: unknown) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.');
    }
  };

  const handleRetryGrantPolling = async () => {
    if (!user || isRetryingGrant) return;
    setIsRetryingGrant(true);

    try {
      const studentId = await resolveStudentId(user.id);
      const grantConfirmed =
        itemType === 'course'
          ? await pollCourseEnrollment(itemId, studentId, 30000, 2000)
          : await pollPYQEnrollment(itemId, studentId, 30000, 2000);

      if (grantConfirmed) {
        setStatus('success');
        if (onSuccess) onSuccess();
        setTimeout(() => {
          onClose();
          if (itemType === 'course') {
            router.push(`/student/courses/${itemId}`);
          } else {
            router.push('/student/tests');
          }
        }, 1800);
      } else {
        setStatus('pending_grant');
      }
    } catch (err: unknown) {
      console.warn('[PaymentModal] Retry polling error:', err);
      setStatus('pending_grant');
    } finally {
      setIsRetryingGrant(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-scrim backdrop-blur-xs animate-fade-quick"
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== 'initiating' && status !== 'verifying' && status !== 'pending_grant') {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-lg overflow-hidden bg-white border border-line rounded-sheet shadow-dialog p-6 sm:p-8 text-ink animate-pop-in">
        {/* Close Button */}
        {status !== 'initiating' && status !== 'verifying' && status !== 'pending_grant' && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-5 right-5 p-2 text-ink-secondary hover:text-ink hover:bg-paper rounded-full transition-colors cursor-pointer"
          >
            <X size={18} weight="bold" />
          </button>
        )}

        {/* ── State 1: Verifying & Grant Polling ── */}
        {status === 'verifying' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-card bg-sky-tint border border-line flex items-center justify-center text-brand mx-auto">
              <CircleNotch size={32} className="animate-spin text-brand" />
            </div>
            <div className="space-y-2">
              <span className="inline-block px-3 py-1 rounded-full text-caption font-bold uppercase tracking-wider bg-sky-tint text-brand">
                PAYMENT RECEIVED
              </span>
              <h3 className="text-xl font-bold text-ink">
                Activating your enrollment...
              </h3>
              <p className="text-caption sm:text-sm text-ink-secondary max-w-xs mx-auto leading-relaxed">
                Confirming access with the academy. Your study dashboard will open in just a moment.
              </p>
            </div>
          </div>
        )}

        {/* ── State 2: Pending-Grant Honesty State (PRD §10.4) ── */}
        {status === 'pending_grant' && (
          <div className="py-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-card bg-sand border border-sand-ink/30 flex items-center justify-center text-sand-ink mx-auto">
              <HourglassMedium size={36} weight="duotone" />
            </div>
            <div className="space-y-2">
              <span className="inline-block px-3 py-1 rounded-full text-caption font-bold uppercase tracking-wider bg-mint text-mint-ink">
                PAYMENT RECEIVED
              </span>
              <h3 className="text-xl font-bold text-ink">
                Payment received — confirming enrollment
              </h3>
              <p className="text-caption sm:text-sm text-ink-secondary max-w-sm mx-auto leading-relaxed">
                We received your payment successfully! Your course access is being granted in the background. You can check again below or continue to your dashboard.
              </p>
            </div>

            <div className="pt-3 flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleRetryGrantPolling}
                disabled={isRetryingGrant}
                className="flex-1 min-h-[44px] py-3 px-4 rounded-field bg-brand hover:bg-brand-hover text-white font-bold text-sm transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {isRetryingGrant ? (
                  <>
                    <CircleNotch size={16} className="animate-spin" />
                    <span>Checking Status...</span>
                  </>
                ) : (
                  <>
                    <ArrowClockwise size={16} weight="bold" />
                    <span>Check Enrollment Status</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  router.push('/student/overview');
                }}
                className="min-h-[44px] py-3 px-4 rounded-field border border-line hover:bg-paper text-ink font-semibold text-sm transition-colors text-center cursor-pointer"
              >
                Go to Dashboard
              </button>
            </div>
          </div>
        )}

        {/* ── State 3: Success Confirmation ── */}
        {status === 'success' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-card bg-mint border border-mint-ink/30 flex items-center justify-center text-mint-ink mx-auto">
              <CheckCircle size={36} weight="fill" className="text-emerald-600" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-2xl font-bold text-ink">
                Enrollment Confirmed!
              </h3>
              <p className="text-caption sm:text-sm text-ink-secondary">
                Welcome aboard! Taking you straight to your learning hub...
              </p>
            </div>
          </div>
        )}

        {/* ── State 4: Normal Review / Checkout Screen ── */}
        {(status === 'idle' || status === 'initiating' || status === 'gateway_open' || status === 'error') && (
          <div className="space-y-6">
            {/* Header / Kicker */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-caption font-extrabold uppercase tracking-wide bg-sky-tint text-brand border border-line">
                  {streamName}
                </span>
                <span className="text-caption text-ink-secondary font-medium">
                  {itemType === 'course' ? 'Course Enrollment' : 'PYQ Package'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-ink leading-tight">
                {itemTitle}
              </h2>
            </div>

            {/* Plan / Access Summary Card */}
            <div className="p-4 rounded-card bg-paper border border-line space-y-3">
              <div className="flex items-center justify-between text-caption sm:text-sm text-ink-secondary">
                <span>Access Type</span>
                <strong className="text-ink font-semibold">
                  {planName || (itemType === 'course' ? 'Full-Course Access' : 'Lifetime Archive')}
                </strong>
              </div>
              <div className="flex items-center justify-between text-caption sm:text-sm text-ink-secondary">
                <span>Validity Duration</span>
                <strong className="text-ink font-semibold">{accessDurationLabel}</strong>
              </div>
              <div className="pt-2.5 border-t border-line flex items-baseline justify-between">
                <span className="text-caption font-bold text-ink uppercase tracking-wide">
                  Total Payable
                </span>
                <div className="text-right">
                  <span className="text-2xl font-bold text-ink tabular-nums">
                    {formatCoursePrice(price, currency)}
                  </span>
                  {originalPrice && originalPrice > price && (
                    <del className="block text-caption text-ink-secondary tabular-nums">
                      {formatCoursePrice(originalPrice, currency)}
                    </del>
                  )}
                </div>
              </div>
            </div>

            {/* Error Message if any */}
            {status === 'error' && errorMessage && (
              <div className="p-3.5 rounded-field bg-red-500/15 border border-red-500/30 flex items-start gap-2.5 text-caption text-red-800">
                <WarningCircle size={18} weight="fill" className="shrink-0 text-red-600 mt-0.5" />
                <p className="leading-relaxed">{errorMessage}</p>
              </div>
            )}

            {/* Authenticated vs Guest Action */}
            {user ? (
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleStartPayment}
                  disabled={status === 'initiating'}
                  className="w-full min-h-[44px] py-3.5 px-5 rounded-field bg-brand hover:bg-brand-hover text-white font-bold text-sm tracking-wide transition-all shadow-md shadow-card flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {status === 'initiating' ? (
                    <>
                      <CircleNotch size={18} className="animate-spin" />
                      <span>Connecting to Razorpay...</span>
                    </>
                  ) : (
                    <>
                      <span>Proceed to Secure Pay</span>
                      <ArrowRight size={16} weight="bold" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-4 text-caption text-ink-secondary font-medium pt-1">
                  <span className="flex items-center gap-1">
                    <ShieldCheck size={14} weight="fill" className="text-emerald-600" />
                    100% Secure SSL
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <LockKey size={14} weight="fill" className="text-brand" />
                    Verified by Razorpay
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                <p className="text-caption text-center text-ink-secondary">
                  Please log in or create an account so we can link this purchase to your student desk.
                </p>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="button"
                    onClick={() => router.push(loginUrl)}
                    className="flex-1 min-h-[44px] py-3 px-4 rounded-field bg-brand hover:bg-brand-hover text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                  >
                    <span>Sign In to Continue</span>
                    <ArrowRight size={14} weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(signupUrl)}
                    className="flex-1 min-h-[44px] py-3 px-4 rounded-field border border-line hover:bg-paper text-ink font-semibold text-xs transition-colors text-center cursor-pointer"
                  >
                    Create Account
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
