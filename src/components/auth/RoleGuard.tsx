'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { getPostLoginDestination } from '@/lib/auth/routing';
import { getDeviceStatusRoute } from '@/types/trustedDevice';
import { CircleNotch } from '@phosphor-icons/react';

/**
 * Props for the RoleGuard component.
 *
 * @template TAllowedRole - Union of allowed role values for type safety.
 */
export interface RoleGuardProps {
  /**
   * Array of role values that are permitted to access this route.
   *
   * Examples:
   *   - `['admin']` — only admins
   *   - `['teacher', 'admin']` — teachers and admins
   *   - `['student']` — only students
   */
  allowedRoles: string[];

  /**
   * Optional array of account_status values that are permitted to access
   * this route.
   *
   * When omitted, any account status is allowed (for the given roles).
   * When present, the user's accountStatus must be in this list — UNLESS
   * the user's role is `'admin'`, in which case the status check is
   * skipped (admins always pass).
   *
   * Examples:
   *   - `['approved']` — only active accounts
   *   - `['approved', 'pending']` — approved and pending accounts
   */
  allowedAccountStatuses?: string[];

  /** Content to render when access is authorised. */
  children: React.ReactNode;
}

/**
 * Reusable route protection component.
 *
 * Wraps a route's content and verifies the current user has the required
 * role and (optionally) account status.  Unauthorised users are redirected
 * to the appropriate destination via the centralised `getPostLoginDestination`
 * routing helper.
 *
 * ## Usage
 *
 * ```tsx
 * // Admin-only route:
 * <RoleGuard allowedRoles={['admin']}>
 *   <Dashboard />
 * </RoleGuard>
 *
 * // Teacher route (approved teachers + admins):
 * <RoleGuard allowedRoles={['teacher', 'admin']} allowedAccountStatuses={['approved']}>
 *   <TeacherDashboard />
 * </RoleGuard>
 * ```
 *
 * ## Behaviour
 *
 * | Scenario | Action |
 * |----------|--------|
 * | Auth still loading | Show loading spinner |
 * | Not authenticated | Redirect to `/` |
 * | Role not in allowedRoles | Redirect via `getPostLoginDestination()` |
 * | Role allowed but status check fails (non-admin) | Redirect via `getPostLoginDestination()` |
 * | Admin user (status check skipped) | Render children |
 * | All checks pass | Render children |
 */
export default function RoleGuard({
  allowedRoles,
  allowedAccountStatuses,
  children,
}: RoleGuardProps) {
  const { teacherProfile, loading, deviceStatus, retryAuth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [redirected, setRedirected] = React.useState(false);
  const [loadTimedOut, setLoadTimedOut] = React.useState(false);
  const [isRetrying, setIsRetrying] = React.useState(false);

  const deviceChecking = teacherProfile?.role === 'admin' && deviceStatus === 'checking';
  const deviceRoute = getDeviceStatusRoute(deviceStatus);
  const onDeviceScreen = deviceRoute !== null && pathname === deviceRoute;

  // Defensive timeout: if auth loading persists >8s, transition to recovery UI
  React.useEffect(() => {
    if (!loading && !deviceChecking) {
      setLoadTimedOut(false);
      setIsRetrying(false);
      return;
    }

    const timer = setTimeout(() => {
      if (loading || deviceChecking) {
        setLoadTimedOut(true);
      }
    }, 8000);

    return () => clearTimeout(timer);
  }, [loading, deviceChecking]);

  const handleRetry = async () => {
    setIsRetrying(true);
    setLoadTimedOut(false);
    try {
      if (retryAuth) {
        await retryAuth();
      }
    } catch (err) {
      console.warn('[RoleGuard] Retry failed:', err);
    } finally {
      setIsRetrying(false);
    }
  };

  React.useEffect(() => {
    // TEMP DEBUG: redirect-decision logging (remove after diagnosis)
    console.log('[TD-roleGuard] effect run', { loading, pathname, deviceStatus, redirected });
    if (redirected) {
      // The redirect latch is set. Clear it once we've actually arrived on
      // the device status screen the redirect targeted (so children can
      // render), or once the device is no longer blocking (approved/bypass —
      // so the pending → dashboard transition works). Without this reset the
      // latch would permanently keep the loading overlay on screen.
      if (teacherProfile?.role === 'admin') {
        const deviceRoute = getDeviceStatusRoute(deviceStatus);
        const arrivedOnDeviceScreen = deviceRoute !== null && pathname === deviceRoute;
        const deviceNoLongerBlocked = deviceRoute === null && deviceStatus !== 'checking';
        if (arrivedOnDeviceScreen || deviceNoLongerBlocked) {
          console.log('[TD-roleGuard] redirected latch CLEARED — rendering children', { pathname, deviceStatus });
          setRedirected(false);
        } else {
          console.log('[TD-roleGuard] effect BAILED — redirected latch still holds', { pathname, deviceStatus });
        }
      }
      return;
    }

    // ── 1. Wait for auth to initialise ──────────────────────────────────
    if (loading) {
      console.log('[TD-roleGuard] holding — auth loading');
      return;
    }

    // ── 2. Not authenticated → redirect to root ─────────────────────────
    if (!teacherProfile) {
      console.log('[TD-roleGuard] REDIRECT → / (not authenticated)');
      setRedirected(true);
      console.log('[TD-roleGuard] redirected latch SET (not authenticated)');
      router.replace('/');
      return;
    }

    const { role, accountStatus } = teacherProfile;

    // ── 3. Check role ───────────────────────────────────────────────────
    if (!allowedRoles.includes(role)) {
      // Role not allowed — redirect to the correct destination
      const destination = getPostLoginDestination(role, accountStatus);
      console.log('[TD-roleGuard] REDIRECT →', destination, '(role not allowed:', role + ')');
      setRedirected(true);
      console.log('[TD-roleGuard] redirected latch SET (role not allowed)');
      router.replace(destination);
      return;
    }

    // ── 3b. Trusted Device gating (admins only — teacher/student
    // behavior is unchanged because their deviceStatus is always
    // 'bypass'). While the challenge is resolving ('checking'), hold
    // the spinner instead of flashing protected content. When the
    // device is blocked, redirect to the matching device screen.
    if (role === 'admin') {
      const deviceRouteForLog = getDeviceStatusRoute(deviceStatus);
      console.log('[TD-roleGuard] admin device gate', { deviceStatus, deviceRouteForLog, pathname });
      if (deviceStatus === 'checking') {
        console.log('[TD-roleGuard] HOLDING SPINNER — deviceStatus stuck at "checking"');
        return;
      }
      const deviceRoute = getDeviceStatusRoute(deviceStatus);
      if (deviceRoute && pathname !== deviceRoute) {
        console.log('[TD-roleGuard] REDIRECT →', deviceRoute, '(device blocked:', deviceStatus + ')');
        setRedirected(true);
        console.log('[TD-roleGuard] redirected latch SET (device blocked)');
        router.replace(deviceRoute);
        return;
      }
    }

    // ── 4. Check account status (admins bypass this check) ──────────────
    if (
      role !== 'admin'
      && allowedAccountStatuses
      && allowedAccountStatuses.length > 0
      && !allowedAccountStatuses.includes(accountStatus)
    ) {
      // Account status not in the allowed list — redirect
      const destination = getPostLoginDestination(role, accountStatus);
      console.log('[TD-roleGuard] REDIRECT →', destination, '(account status blocked:', accountStatus + ')');
      setRedirected(true);
      console.log('[TD-roleGuard] redirected latch SET (account status blocked)');
      router.replace(destination);
      return;
    }

    // ── 5. All checks pass — children will be rendered ──────────────────
    console.log('[TD-roleGuard] ALL CHECKS PASS — rendering on', pathname);
  }, [
    teacherProfile,
    loading,
    allowedRoles,
    allowedAccountStatuses,
    deviceStatus,
    pathname,
    router,
    redirected,
  ]);

  // ── Recovery UI (Timeout exceeded >8s) ─────────────────────────────────
  if (loadTimedOut && !onDeviceScreen && (loading || deviceChecking)) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-navy-900 to-slate-900 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 max-w-sm w-full text-center bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <CircleNotch size={24} className={isRetrying ? 'animate-spin' : ''} />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-slate-100 font-display">
              Authentication Taking Longer Than Expected
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              We're having trouble connecting to the authentication service. This may be due to a slow connection or temporary service delay.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2.5 w-full pt-2">
            <button
              type="button"
              onClick={handleRetry}
              disabled={isRetrying}
              className="flex-1 py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-slate-950 font-bold text-xs tracking-wide uppercase transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isRetrying ? (
                <>
                  <CircleNotch size={14} className="animate-spin" />
                  <span>Retrying...</span>
                </>
              ) : (
                <span>Retry Connection</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => router.replace('/')}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-all"
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading / device-checking state ───────────────────────────────────
  if ((loading || redirected || deviceChecking) && !onDeviceScreen) {
    console.log('[SPINNER]', {
      component: 'RoleGuard',
      pathname,
      loading,
      redirected,
      deviceStatus,
    });
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-navy-900 to-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <CircleNotch size={28} className="animate-spin text-amber-400" />
          <p className="text-xs text-slate-400 font-mono">
            {loading
              ? 'Verifying credentials...'
              : deviceChecking
                ? 'Verifying device...'
                : 'Redirecting...'}
          </p>
        </div>
      </div>
    );
  }

  // ── Not authorised (checks failed above, but render nothing as safety) ─
  if (!teacherProfile) {
    return null;
  }

  const { role, accountStatus } = teacherProfile;

  if (!allowedRoles.includes(role)) {
    return null;
  }

  // Blocked device — render nothing (the effect handles the redirect).
  if (role === 'admin') {
    const deviceRoute = getDeviceStatusRoute(deviceStatus);
    if (deviceRoute && pathname !== deviceRoute) {
      return null;
    }
  }

  if (
    role !== 'admin'
    && allowedAccountStatuses
    && allowedAccountStatuses.length > 0
    && !allowedAccountStatuses.includes(accountStatus)
  ) {
    return null;
  }

  // ── Authorised — render children ──────────────────────────────────────
  return <>{children}</>;
}
