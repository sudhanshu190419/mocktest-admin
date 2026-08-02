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
  const { teacherProfile, loading, deviceStatus } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [redirected, setRedirected] = React.useState(false);

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

  // ── Loading / device-checking state ───────────────────────────────────
  // A 'checking' device status means the trusted-device challenge is still
  // resolving — hold the spinner instead of flashing protected content.
  // Trusted-device screens: once the URL is already one of the device status
  // pages, never block rendering with the redirect/loading overlay — render
  // children so the device page (pending / rejected / revoked / expired) can
  // display.
  const deviceChecking = teacherProfile?.role === 'admin' && deviceStatus === 'checking';
  const deviceRoute = getDeviceStatusRoute(deviceStatus);
  const onDeviceScreen = deviceRoute !== null && pathname === deviceRoute;
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
