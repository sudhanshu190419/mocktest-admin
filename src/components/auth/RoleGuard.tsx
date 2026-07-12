'use client';

import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { getPostLoginDestination } from '@/lib/auth/routing';
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
  const { teacherProfile, loading } = useAuth();
  const router = useRouter();
  const [redirected, setRedirected] = React.useState(false);

  React.useEffect(() => {
    if (redirected) return;

    // ── 1. Wait for auth to initialise ──────────────────────────────────
    if (loading) return;

    // ── 2. Not authenticated → redirect to root ─────────────────────────
    if (!teacherProfile) {
      setRedirected(true);
      router.replace('/');
      return;
    }

    const { role, accountStatus } = teacherProfile;

    // ── 3. Check role ───────────────────────────────────────────────────
    if (!allowedRoles.includes(role)) {
      // Role not allowed — redirect to the correct destination
      const destination = getPostLoginDestination(role, accountStatus);
      setRedirected(true);
      router.replace(destination);
      return;
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
      setRedirected(true);
      router.replace(destination);
      return;
    }

    // ── 5. All checks pass — children will be rendered ──────────────────
  }, [teacherProfile, loading, allowedRoles, allowedAccountStatuses, router, redirected]);

  // ── Loading state ─────────────────────────────────────────────────────
  if (loading || redirected) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-navy-900 to-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <CircleNotch size={28} className="animate-spin text-amber-400" />
          <p className="text-xs text-slate-400 font-mono">
            {loading ? 'Verifying credentials...' : 'Redirecting...'}
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
