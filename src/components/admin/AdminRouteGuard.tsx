'use client';

import React, { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CircleNotch } from '@phosphor-icons/react';
import type { AdminPermission } from '@/types/adminRoles';
import { usePermissions } from '@/hooks/admin/usePermissions';
import { getRequiredPermission } from '@/lib/admin/routePermissions';

/**
 * Props for the AdminRouteGuard component.
 */
export interface AdminRouteGuardProps {
  /**
   * Content to render when the current admin is authorised.
   */
  children: React.ReactNode;

  /**
   * Optional explicit permission requirement.
   *
   * When omitted, the required permission is resolved from the route
   * permission matrix (`src/lib/admin/routePermissions.ts`) using the
   * current pathname. This is the recommended usage — the matrix stays the
   * single source of truth.
   *
   * Provide this only for routes that need custom in-code gating.
   */
  permission?: AdminPermission;

  /**
   * Optional redirect target when access is denied.
   *
   * @default '/admin' (the admin dashboard).
   */
  redirectTo?: string;
}

/**
 * Route-level protection for the admin area.
 *
 * Verifies the current admin holds the permission required for the current
 * route. When access is denied, the user is redirected to the admin
 * dashboard (or `redirectTo`).
 *
 * ## Behaviour
 *
 * | Scenario                    | Action                        |
 * |----------------------------|-------------------------------|
 * | Route has no permission    | Render children               |
 * | Route permission granted   | Render children               |
 * | Route permission denied    | Redirect to `/admin`          |
 * | Not an admin at all        | Rendered nothing (RoleGuard handles role checks in layout) |
 *
 * ## Usage (recommended — matrix-driven)
 *
 * ```tsx
 * <AdminRouteGuard>
 *   <TeachersPage />
 * </AdminRouteGuard>
 * ```
 *
 * The guard reads the current pathname and resolves the required permission
 * automatically from `adminRoutePermissions`.
 *
 * ## Usage (explicit)
 *
 * ```tsx
 * <AdminRouteGuard permission="accessFinance" redirectTo="/admin">
 *   <RevenuePage />
 * </AdminRouteGuard>
 * ```
 *
 * @see PermissionGuard for in-page section-level hiding (no redirect).
 */
export function AdminRouteGuard({
  children,
  permission,
  redirectTo = '/admin',
}: AdminRouteGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { can } = usePermissions();

  // Resolve the required permission from the matrix when not provided
  const requiredPermission = permission ?? getRequiredPermission(pathname);

  const denied = requiredPermission ? !can(requiredPermission) : false;

  // Redirect on denial — but only once per guard instance
  const redirectingRef = useRef(false);
  useEffect(() => {
    if (!denied || redirectingRef.current) return;
    redirectingRef.current = true;
    router.replace(redirectTo);
  }, [denied, redirectTo, router]);

  // Show a brief spinner while redirecting (avoid a flash of the protected page)
  if (denied) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-gray-50 dark:bg-gray-950/50">
        <div className="flex flex-col items-center gap-3">
          <CircleNotch size={28} className="animate-spin text-amber-500" />
          <p className="font-mono text-xs text-gray-500 dark:text-gray-400">
            Checking permissions...
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default AdminRouteGuard;
