'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Lock,
  Phone,
  Eye,
  EyeSlash,
  CircleNotch,
  WarningCircle,
  CheckCircle,
  ShieldCheck,
  ArrowRight,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import {
  initiatePhoneChange,
  verifyPhoneChangeOtp,
  resendPhoneChangeOtp,
  normalizePhoneNumber,
} from '@/services/student/studentProfileWebService';

interface ChangeMobileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  currentPhone: string | null;
  currentEmail: string | null;
  onSuccess: (newPhone: string) => void;
}

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export const ChangeMobileModal: React.FC<ChangeMobileModalProps> = ({
  isOpen,
  onClose,
  userId,
  currentPhone,
  currentEmail,
  onSuccess,
}) => {
  // Step 1: Input | Step 2: OTP Verification
  const [step, setStep] = useState<1 | 2>(1);

  // Form fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rawNewPhone, setRawNewPhone] = useState('');
  const [otpValues, setOtpValues] = useState<string[]>(Array(OTP_LENGTH).fill(''));

  // Status
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // Cooldown timer
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [canResend, setCanResend] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // OTP inputs refs
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setCurrentPassword('');
      setShowPassword(false);
      setRawNewPhone('');
      setOtpValues(Array(OTP_LENGTH).fill(''));
      setError(null);
      setResendMessage(null);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCanResend(false);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isOpen]);

  const startCooldown = () => {
    setCanResend(false);
    setCooldown(RESEND_COOLDOWN_SECONDS);

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword.trim()) {
      setError('Please enter your current password.');
      return;
    }

    const cleanDigits = rawNewPhone.replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }

    const formattedNewPhone = normalizePhoneNumber(rawNewPhone);

    setSubmitting(true);
    try {
      const res = await initiatePhoneChange({
        newPhone: formattedNewPhone,
        currentPassword,
        currentPhone,
        currentEmail,
      });

      if (res.error || !res.data) {
        setError(res.error || 'Failed to initiate mobile number change.');
      } else {
        setStep(2);
        startCooldown();
        // Focus first OTP field
        setTimeout(() => {
          otpInputRefs.current[0]?.focus();
        }, 150);
      }
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    // Handle pasting a full code
    if (value.length > 1) {
      const pastedDigits = value.replace(/\D/g, '').slice(0, OTP_LENGTH).split('');
      const newOtp = [...otpValues];
      pastedDigits.forEach((digit, i) => {
        if (i < OTP_LENGTH) newOtp[i] = digit;
      });
      setOtpValues(newOtp);
      const nextFocus = Math.min(pastedDigits.length, OTP_LENGTH - 1);
      otpInputRefs.current[nextFocus]?.focus();
      return;
    }

    const digit = value.replace(/\D/g, '');
    const newOtp = [...otpValues];
    newOtp[index] = digit;
    setOtpValues(newOtp);

    // Auto advance
    if (digit && index < OTP_LENGTH - 1) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpValues[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = async () => {
    if (!canResend || resending) return;

    setResending(true);
    setError(null);
    setResendMessage(null);

    const formattedNewPhone = normalizePhoneNumber(rawNewPhone);

    try {
      const res = await resendPhoneChangeOtp(formattedNewPhone);
      if (res.error) {
        setError(res.error);
      } else {
        setResendMessage('A new verification code has been sent.');
        setOtpValues(Array(OTP_LENGTH).fill(''));
        startCooldown();
        otpInputRefs.current[0]?.focus();
        setTimeout(() => setResendMessage(null), 5000);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to resend verification code.');
    } finally {
      setResending(false);
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const fullOtp = otpValues.join('');
    if (fullOtp.length !== OTP_LENGTH) {
      setError(`Please enter the complete ${OTP_LENGTH}-digit verification code.`);
      return;
    }

    const formattedNewPhone = normalizePhoneNumber(rawNewPhone);

    setSubmitting(true);
    try {
      const res = await verifyPhoneChangeOtp({
        userId,
        newPhone: formattedNewPhone,
        token: fullOtp,
      });

      if (res.error || !res.data) {
        setError(res.error || 'Invalid or expired OTP. Please try again.');
      } else {
        onSuccess(res.data.phone);
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const formattedNewPhoneDisplay = normalizePhoneNumber(rawNewPhone);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 border border-sky-100">
              <ShieldCheck size={20} weight="bold" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">
                {step === 1 ? 'Change Mobile Number' : 'Verify Mobile Number'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {step === 1 ? 'Verify identity to update login number' : 'Enter the code sent to your new phone'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Feedback Banners */}
        <div className="px-6 pt-4 space-y-2">
          {error && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <WarningCircle size={18} weight="fill" className="text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {resendMessage && (
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <CheckCircle size={16} weight="fill" className="text-emerald-600 shrink-0" />
              <span>{resendMessage}</span>
            </div>
          )}
        </div>

        {/* Step 1 Form: Current Password + New Number */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="p-6 space-y-4">
            {/* Current Mobile Display */}
            {currentPhone && (
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Current Number</span>
                <span className="font-bold text-slate-700">{currentPhone}</span>
              </div>
            )}

            {/* Current Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">Current Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  required
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* New Phone Number */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">New Mobile Number</label>
              <div className="flex rounded-xl border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-sky-500/20 focus-within:border-sky-500 transition-all">
                <div className="flex items-center gap-1.5 px-3 bg-slate-50 border-r border-slate-200 text-slate-600 text-xs font-bold shrink-0">
                  <Phone size={14} className="text-slate-400" />
                  <span>+91</span>
                </div>
                <input
                  type="tel"
                  value={rawNewPhone}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                    setRawNewPhone(val);
                  }}
                  placeholder="9876543210"
                  required
                  maxLength={10}
                  className="w-full px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-slate-400">
                An SMS OTP will be sent to this number for verification.
              </p>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <CircleNotch size={14} className="animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <span>Send Verification Code</span>
                    <ArrowRight size={14} weight="bold" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Step 2 Form: 6-Digit OTP Verification */}
        {step === 2 && (
          <form onSubmit={handleStep2Submit} className="p-6 space-y-5">
            <div className="p-3.5 rounded-2xl bg-sky-50/60 border border-sky-100 text-center space-y-0.5">
              <p className="text-xs text-sky-900 font-semibold">
                Verification code sent to
              </p>
              <p className="text-sm font-black text-sky-950 font-mono tracking-wider">
                {formattedNewPhoneDisplay}
              </p>
            </div>

            {/* 6 OTP Boxes */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block text-center">
                Enter 6-Digit Verification Code
              </label>
              <div className="flex items-center justify-center gap-2">
                {otpValues.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      otpInputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={idx === 0 ? OTP_LENGTH : 1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className="h-12 w-11 text-center text-lg font-black font-mono rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition-all shadow-2xs"
                  />
                ))}
              </div>
            </div>

            {/* Resend Action */}
            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setError(null);
                }}
                className="text-sky-600 hover:text-sky-700 font-bold hover:underline"
              >
                Change Number
              </button>

              <button
                type="button"
                onClick={handleResend}
                disabled={!canResend || resending}
                className="inline-flex items-center gap-1 font-bold text-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed hover:text-slate-900 transition-colors"
              >
                <ArrowCounterClockwise size={13} className={resending ? 'animate-spin' : ''} />
                <span>
                  {canResend
                    ? 'Resend OTP'
                    : `Resend in ${cooldown}s`}
                </span>
              </button>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <CircleNotch size={14} className="animate-spin" />
                    <span>Verifying...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={15} weight="bold" />
                    <span>Verify & Update Mobile</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
