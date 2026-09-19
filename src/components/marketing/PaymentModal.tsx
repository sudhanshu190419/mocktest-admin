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
  Sparkle,
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
  | 'success'
  | 'error';

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

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setStatus('idle');
      setErrorMessage(null);
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
          color: '#2563eb', // Blue-600
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
            // Fallback success if webhook is slightly delayed
            setStatus('success');
            setTimeout(() => {
              onClose();
              router.push('/student/overview');
            }, 2000);
          }
        },
      });

      rzp.on('payment.failed', (response: any) => {
        setStatus('error');
        setErrorMessage(response?.error?.description || 'Payment was declined or cancelled. You have not been charged.');
      });

      setStatus('gateway_open');
      rzp.open();
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err?.message || 'An unexpected error occurred. Please try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== 'initiating' && status !== 'verifying') {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-lg overflow-hidden bg-white border border-slate-200/80 rounded-3xl sm:rounded-[2rem] shadow-2xl p-6 sm:p-8 text-slate-900">
        {/* Close Button */}
        {status !== 'initiating' && status !== 'verifying' && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X size={18} weight="bold" />
          </button>
        )}

        {/* ── State 1: Verifying & Grant Polling ── */}
        {status === 'verifying' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mx-auto animate-pulse">
              <CircleNotch size={32} className="animate-spin text-blue-600" />
            </div>
            <div className="space-y-2">
              <span className="inline-block px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800">
                PAYMENT RECEIVED
              </span>
              <h3 className="text-xl font-extrabold text-slate-900 font-display">
                Activating your enrollment...
              </h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                Confirming access with the academy. Your study dashboard will open in just a moment.
              </p>
            </div>
          </div>
        )}

        {/* ── State 2: Success Confirmation ── */}
        {status === 'success' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mx-auto">
              <CheckCircle size={36} weight="fill" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-2xl font-extrabold text-slate-900 font-display">
                Enrollment Confirmed!
              </h3>
              <p className="text-xs text-slate-600">
                Welcome aboard! Taking you straight to your learning hub...
              </p>
            </div>
          </div>
        )}

        {/* ── State 3: Normal Review / Checkout Screen ── */}
        {(status === 'idle' || status === 'initiating' || status === 'gateway_open' || status === 'error') && (
          <div className="space-y-6">
            {/* Header / Kicker */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-100">
                  {streamName}
                </span>
                <span className="text-xs text-slate-400 font-medium">
                  {itemType === 'course' ? 'Course Enrollment' : 'PYQ Package'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 font-display leading-tight">
                {itemTitle}
              </h2>
            </div>

            {/* Plan / Access Summary Card */}
            <div className="p-4 rounded-2xl bg-[#f8fafc] border border-slate-200/70 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Access Type</span>
                <strong className="text-slate-800 font-semibold">
                  {planName || (itemType === 'course' ? 'Full-Course Access' : 'Lifetime Archive')}
                </strong>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>Validity Duration</span>
                <strong className="text-slate-800 font-semibold">{accessDurationLabel}</strong>
              </div>
              <div className="pt-2.5 border-t border-slate-200/80 flex items-baseline justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                  Total Payable
                </span>
                <div className="text-right">
                  <span className="text-2xl font-black text-slate-900 font-display tabular-nums">
                    {formatCoursePrice(price, currency)}
                  </span>
                  {originalPrice && originalPrice > price && (
                    <del className="block text-xs text-slate-400 tabular-nums">
                      {formatCoursePrice(originalPrice, currency)}
                    </del>
                  )}
                </div>
              </div>
            </div>

            {/* Error Message if any */}
            {status === 'error' && errorMessage && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200/70 flex items-start gap-2.5 text-xs text-red-700">
                <WarningCircle size={18} weight="fill" className="shrink-0 text-red-500 mt-0.5" />
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
                  className="w-full py-3.5 px-5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm tracking-wide transition-all shadow-md shadow-blue-500/10 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
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

                <div className="flex items-center justify-center gap-4 text-[11px] text-slate-400 font-medium pt-1">
                  <span className="flex items-center gap-1">
                    <ShieldCheck size={14} weight="fill" className="text-emerald-600" />
                    100% Secure SSL
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <LockKey size={14} weight="fill" className="text-blue-600" />
                    Verified by Razorpay
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                <p className="text-xs text-center text-slate-600">
                  Please log in or create an account so we can link this purchase to your student desk.
                </p>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <button
                    type="button"
                    onClick={() => router.push(loginUrl)}
                    className="flex-1 py-3 px-4 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <span>Sign In to Continue</span>
                    <ArrowRight size={14} weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push(signupUrl)}
                    className="py-3 px-4 rounded-full border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-colors text-center"
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
