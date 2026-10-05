'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/config/supabase';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function DeleteAccountPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [phone, setPhone] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cooldown
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [canResend, setCanResend] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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

  const formatPhoneE164 = (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('91') && digits.length === 12) {
      return `+${digits}`;
    }
    if (digits.length === 10) {
      return `+91${digits}`;
    }
    if (raw.startsWith('+')) {
      return `+${digits}`;
    }
    return `+91${digits}`;
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const formatted = formatPhoneE164(phone);
    if (!phone.trim() || formatted.length < 12) {
      setErrorMessage('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    if (!confirmed) {
      setErrorMessage('You must confirm that you understand account deletion is permanent.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: formatted,
        options: {
          shouldCreateUser: false,
        },
      });

      if (error) {
        setErrorMessage(error.message || 'Could not send verification code. Check your mobile number.');
        return;
      }

      setStep(2);
      startCooldown();
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 100);
    } catch (err: any) {
      setErrorMessage(err?.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!canResend) return;
    setErrorMessage(null);
    setResending(true);
    try {
      const formatted = formatPhoneE164(phone);
      const { error } = await supabase.auth.signInWithOtp({
        phone: formatted,
        options: {
          shouldCreateUser: false,
        },
      });

      if (error) {
        setErrorMessage(error.message || 'Failed to resend verification code.');
        return;
      }

      startCooldown();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to resend verification code.');
    } finally {
      setResending(false);
    }
  };

  const handleOtpChange = (index: number, val: string) => {
    const cleaned = val.replace(/\D/g, '');
    const newOtp = [...otp];

    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, OTP_LENGTH).split('');
      for (let i = 0; i < OTP_LENGTH; i++) {
        newOtp[i] = chars[i] || '';
      }
      setOtp(newOtp);
      const nextFocus = Math.min(chars.length, OTP_LENGTH - 1);
      inputRefs.current[nextFocus]?.focus();
      return;
    }

    newOtp[index] = cleaned;
    setOtp(newOtp);

    if (cleaned && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleConfirmDelete = async () => {
    const token = otp.join('');
    if (token.length !== OTP_LENGTH) {
      setErrorMessage('Please enter the complete 6-digit verification code.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const formatted = formatPhoneE164(phone);

      // 1. Authenticate with Supabase Auth using the OTP
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        phone: formatted,
        token,
        type: 'sms',
      });

      if (verifyError || !verifyData.session) {
        setErrorMessage(verifyError?.message || 'Invalid or expired OTP code.');
        setLoading(false);
        return;
      }

      const accessToken = verifyData.session.access_token;

      // 2. Invoke the Edge Function using the authenticated Bearer token
      const { data: functionData, error: functionError } = await supabase.functions.invoke(
        'user-account-delete',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (functionError) {
        setErrorMessage(functionError.message || 'Failed to complete account deletion on server.');
        setLoading(false);
        return;
      }

      if (functionData && functionData.success === false) {
        setErrorMessage(functionData.error || 'Account deletion failed.');
        setLoading(false);
        return;
      }

      // 3. Clean up browser session
      await supabase.auth.signOut();

      setStep(3);
    } catch (err: any) {
      setErrorMessage(err?.message || 'An unexpected error occurred during account deletion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between font-sans">
      {/* Header */}
      <header className="w-full bg-white border-b border-slate-200 py-4 px-6 sm:px-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center font-bold text-white text-lg shadow-sm">
            MT
          </div>
          <div>
            <span className="font-extrabold text-slate-900 text-lg tracking-tight">Make Me Topper</span>
            <span className="block text-xs text-slate-500 font-medium">Official Portal</span>
          </div>
        </Link>
        <Link
          href="/"
          className="text-sm font-semibold text-slate-600 hover:text-sky-600 transition-colors"
        >
          Return to Home &rarr;
        </Link>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-12 flex flex-col justify-center">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl shadow-slate-100 p-6 sm:p-10">
          {/* Top Badge */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600 font-bold">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                Delete Make Me Topper Account
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 font-medium">
                Google Play Store Data Safety & Account Privacy Portal
              </p>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}

          {step === 1 && (
            <form onSubmit={handleSendOtp} className="space-y-6">
              <div className="p-4 sm:p-5 rounded-xl bg-red-50/70 border border-red-200 text-sm text-red-950 space-y-3">
                <p className="font-bold text-red-900">
                  Please read carefully before proceeding:
                </p>
                <p className="text-xs sm:text-sm text-red-800 leading-relaxed">
                  Requesting account deletion will permanently delete your Make Me Topper account and erase the following personal data:
                </p>
                <ul className="list-disc pl-5 text-xs sm:text-sm space-y-1.5 text-red-800">
                  <li>Your user profile, login credentials, and personal details.</li>
                  <li>Mock test attempts, recorded scores, answers, and ranking history.</li>
                  <li>Access to all enrolled and purchased courses, PYQ packages, and test series.</li>
                  <li>Saved study notes, bookmarks, and doubt discussions.</li>
                  <li>Active device sessions and push notification registrations.</li>
                </ul>
                <p className="text-xs text-red-700 italic pt-1">
                  Note: Transaction numbers and statutory financial invoice records are legally retained in an unlinked, anonymized form for accounting and GST compliance.
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-800 mb-2">
                  Registered Mobile Number
                </label>
                <div className="relative flex items-center">
                  <span className="absolute left-4 text-slate-500 font-bold text-sm select-none">
                    +91
                  </span>
                  <input
                    type="tel"
                    maxLength={10}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="Enter 10-digit mobile number"
                    className="w-full pl-14 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all text-sm sm:text-base"
                    disabled={loading}
                    required
                  />
                </div>
              </div>

              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="confirm-deletion"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 w-4 h-4 text-red-600 rounded border-slate-300 focus:ring-red-500 cursor-pointer"
                />
                <label htmlFor="confirm-deletion" className="text-xs sm:text-sm text-slate-700 font-medium cursor-pointer">
                  I understand that deleting my account is permanent and cannot be undone. All active course access and test series will be forfeit.
                </label>
              </div>

              <button
                type="submit"
                disabled={loading || !confirmed || phone.length < 10}
                className="w-full py-3.5 px-6 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-sm sm:text-base shadow-md shadow-red-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <span className="inline-block animate-spin">&#8635; Sending SMS OTP...</span>
                ) : (
                  <span>Send Verification Code &rarr;</span>
                )}
              </button>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center space-y-1">
                <p className="text-sm text-slate-600">
                  Enter the 6-digit verification code sent via SMS to:
                </p>
                <p className="font-extrabold text-slate-900 text-base">
                  {formatPhoneE164(phone)}
                </p>
              </div>

              {/* OTP Inputs */}
              <div className="flex justify-center gap-2 sm:gap-3 my-4">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    disabled={loading}
                    className="w-11 sm:w-13 h-13 sm:h-15 text-center text-xl sm:text-2xl font-black bg-slate-50 border-2 border-slate-300 focus:border-red-600 focus:bg-white focus:outline-none rounded-xl transition-all"
                  />
                ))}
              </div>

              {/* Resend Cooldown */}
              <div className="text-center text-xs sm:text-sm">
                {canResend ? (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resending || loading}
                    className="font-bold text-sky-600 hover:underline cursor-pointer"
                  >
                    {resending ? 'Resending code...' : 'Resend Verification Code'}
                  </button>
                ) : (
                  <span className="text-slate-500">
                    Resend code in <strong className="text-slate-900">{cooldown}s</strong>
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setStep(1); setErrorMessage(null); }}
                  disabled={loading}
                  className="w-full sm:w-1/3 py-3 px-4 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-sm transition-all"
                >
                  &larr; Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={loading || otp.join('').length !== OTP_LENGTH}
                  className="w-full sm:w-2/3 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-sm sm:text-base shadow-md shadow-red-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? (
                    <span className="inline-block animate-spin">&#8635; Deleting Account...</span>
                  ) : (
                    <span>Permanently Delete Account</span>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-2">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-black text-slate-900">
                Account Successfully Deleted
              </h2>
              <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                Your Make Me Topper account and all associated profile, assessment, and personal data have been permanently erased from our servers.
              </p>
              <div className="pt-6">
                <Link
                  href="/"
                  className="inline-block py-3 px-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-md transition-all"
                >
                  Return to Make Me Topper Home
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-6 text-center text-xs text-slate-500 border-t border-slate-200 bg-white">
        &copy; {new Date().getFullYear()} Make Me Topper. All rights reserved. &bull;{' '}
        <Link href="/privacy-policy" className="hover:underline text-slate-600">Privacy Policy</Link> &bull;{' '}
        <Link href="/" className="hover:underline text-slate-600">Terms of Service</Link>
      </footer>
    </div>
  );
}
