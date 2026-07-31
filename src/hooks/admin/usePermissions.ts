/**
 * usePermissions
 *
 * Reusable React hook exposing the current admin user's permissions.
 *
 * Reads `adminRoles` from the authenticated profile in `AuthContext` (the
 * live auth source used across the app — LoginView, RoleGuard, AdminHeader
 * and every admin page consume `useAuth` from `@/context/AuthContext`).
 * `adminRoles` is populated there during profile loading for admins only
 * (see `AuthContext.loadTeacherProfileDetails`), then resolved through the
 * `permissionService` helpers. Components should consume permissions via
 * this hook — never hardcode role names.
 *
 * ## Backward compatibility
 *
 * After the Phase 1 backfill every existing admin holds an approved
 * `super_admin` role, so `adminRoles` is normally populated. However, to
 * guarantee that existing super admins NEVER lose access during the
 * transition (e.g. stale session where adminRoles is undefined), an admin
 * with NO loaded roles is treated as full-access. This mirrors the legacy
 * behaviour where `profiles.role = 'admin'` granted everything.
 *
 * @module hooks/admin/usePermissions
 */

import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import type { AdminPermission, AdminRoleAssignment } from '@/types/adminRoles';
import {
  canManageAdmins,
  canApproveAcademicResources,
  canAccessFinance,
  canViewAuditLogs,
  canRestoreDeletedData,
  canManageSystemSettings,
  isSuperAdmin,
  isAcademicAdmin,
  isFinanceAdmin,
  isAnyAdmin,
  checkPermission,
} from '@/services/admin/permissionService';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UsePermissionsResult {
  /** Raw admin role assignments (may be undefined for legacy sessions). */
  adminRoles: AdminRoleAssignment[] | undefined;

  // Role checks
  isSuperAdmin: boolean;
  isAcademicAdmin: boolean;
  isFinanceAdmin: boolean;
  isAnyAdmin: boolean;

  // Permission helpers (the canonical API — prefer these over role checks)
  canManageAdmins: boolean;
  canApproveAcademicResources: boolean;
  canAccessFinance: boolean;
  canViewAuditLogs: boolean;
  canRestoreDeletedData: boolean;
  canManageSystemSettings: boolean;

  /**
   * Resolve an arbitrary named permission.
   *
   * Useful for data-driven UI and for PermissionGuard:
   * ```ts
   * const { can } = usePermissions();
   * if (can('accessFinance')) { ... }
   * ```
   */
  can: (permission: AdminPermission) => boolean;

  /** True when adminRoles were actually loaded from the backend. */
  rolesLoaded: boolean;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function usePermissions(): UsePermissionsResult {
  const { teacherProfile } = useAuth();

  return useMemo<UsePermissionsResult>(() => {
    const adminRoles = teacherProfile?.adminRoles;

    // Backward-compat: an admin whose roles haven't loaded (undefined) keeps
    // full access so nothing disappears during the transition. Once roles
    // ARE loaded (even as an empty array), the permission matrix applies
    // strictly — a legitimately role-less admin gets the dashboard only.
    const rolesLoaded = Array.isArray(adminRoles);
    const legacyFullAccess = teacherProfile?.role === 'admin' && !rolesLoaded;

    const resolve = (permission: AdminPermission): boolean =>
      legacyFullAccess || checkPermission(adminRoles, permission);

    return {
      adminRoles,
      isSuperAdmin: legacyFullAccess || isSuperAdmin(adminRoles),
      isAcademicAdmin: isAcademicAdmin(adminRoles),
      isFinanceAdmin: isFinanceAdmin(adminRoles),
      isAnyAdmin: legacyFullAccess || isAnyAdmin(adminRoles),
      canManageAdmins: resolve('manageAdmins'),
      canApproveAcademicResources: resolve('approveAcademicResources'),
      canAccessFinance: resolve('accessFinance'),
      canViewAuditLogs: resolve('viewAuditLogs'),
      canRestoreDeletedData: resolve('restoreDeletedData'),
      canManageSystemSettings: resolve('manageSystemSettings'),
      can: resolve,
      rolesLoaded,
    };
  }, [teacherProfile]);
}
