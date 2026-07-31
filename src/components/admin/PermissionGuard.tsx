'use client';

import React from 'react';
import type { AdminPermission } from '@/types/adminRoles';
import { usePermissions } from '@/hooks/admin/usePermissions';

/**
 * Props for the PermissionGuard component.
 */
export interface PermissionGuardProps {
  /**
   * The permission required to render `children`.
   *
   * Resolved via `permissionService` — never a raw role name.
   */
  permission: AdminPermission;

  /** Content to render when the current admin holds the permission. */
  children: React.ReactNode;

  /**
   * Optional fallback rendered when permission is missing.
   *
   * Defaults to `null` (render nothing). For hide-vs-show UIs inside a
   * page (buttons, tabs, sections), pass a custom fallback or just omit it.
   */
  fallback?: React.ReactNode;
}

/**
 * Reusable permission-gated wrapper for UI sections.
 *
 * Use this for fine-grained hiding of buttons, tabs, or sections within a
 * page — unlike `AdminRouteGuard`, it does NOT redirect, it simply renders
 * or hides content.
 *
 * ## Usage
 *
 * ```tsx
 * <PermissionGuard permission="accessFinance">
 *   <RevenueCard />
 * </PermissionGuard>
 *
 * <PermissionGuard permission="canViewAuditLogs" fallback={<LockedNote />}>
 *   <AuditTable />
 * </PermissionGuard>
 * ```
 *
 * @see AdminRouteGuard for route-level protection.
 */
export function PermissionGuard({
  permission,
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { can } = usePermissions();

  if (!can(permission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export default PermissionGuard;
