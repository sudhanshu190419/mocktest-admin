'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { CircleNotch, WarningCircle } from '@phosphor-icons/react';

export function StudentGuard({ children }: { children: React.ReactNode }) {
  const { user, teacherProfile, loading, retryAuth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [redirected, setRedirected] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Timeout guard for slow auth (8s)
  useEffect(() => {
    if (!loading) {
      setLoadTimedOut(false);
      setIsRetrying(false);
      return;
    }

    const timer = setTimeout(() => {
      if (loading) {
        setLoadTimedOut(true);
      }
    }, 8000);

    return () => clearTimeout(timer);
  }, [loading]);

  const handleRetry = async () => {
    setIsRetrying(true);
    setLoadTimedOut(false);
    try {
      if (retryAuth) {
        await retryAuth();
      }
    } catch {
      // Ignored
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    if (loading || redirected) return;

    // 1. If not authenticated, redirect to login
    if (!user) {
      setRedirected(true);
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    // 2. If user is a teacher, redirect to teacher dashboard
    if (teacherProfile && teacherProfile.role === 'teacher') {
      setRedirected(true);
      router.replace('/teacher');
      return;
    }
  }, [user, teacherProfile, loading, pathname, router, redirected]);

  // 1. Timeout State (Design A Styled)
  if (loadTimedOut && loading) {
    return (
      <div className="min-h-screen w-full bg-[#f3f8fc] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 max-w-md w-full text-center bg-white border border-slate-200/80 rounded-3xl p-8 shadow-xl shadow-slate-900/5">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200/60 flex items-center justify-center text-amber-600">
            <WarningCircle size={26} weight="duotone" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-slate-900 font-display">
              Connecting to Student Portal...
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
              We&apos;re experiencing a brief delay while verifying your session. Please try reconnecting or signing in again.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 w-full pt-2">
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs tracking-wide transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
            >
              {isRetrying ? (
                <>
                  <CircleNotch size={14} className="animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <span>Retry Connection</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => router.replace(`/login?next=${encodeURIComponent(pathname)}`)}
              className="py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all"
            >
              Sign In Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Loading / Redirecting State (Design A Styled)
  if (loading || redirected) {
    return (
      <div className="min-h-screen w-full bg-[#f3f8fc] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="w-10 h-10 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-xs">
            <CircleNotch size={22} className="animate-spin text-blue-600" />
          </span>
          <p className="text-xs font-semibold text-slate-500 font-display tracking-tight">
            {loading ? 'Opening Student Workspace...' : 'Redirecting...'}
          </p>
        </div>
      </div>
    );
  }

  // 3. Not authorised fallback (render nothing while redirecting)
  if (!user) {
    return null;
  }

  return <>{children}</>;
}
