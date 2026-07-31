/**
 * Admin Permission Service
 *
 * Reusable permission helpers for the Admin Roles architecture (Domain 18).
 *
 * These helpers resolve capabilities from a profile's APPROVED admin roles.
 * They replace scattered manual role checks so frontend and service code can
 * simply call `permission.canApproveAcademicResources(adminRoles)`.
 *
 * ## Permission matrix
 *
 * | Capability                | super_admin | academic_admin | finance_admin |
 * |---------------------------|:-----------:|:--------------:|:-------------:|
 * | canManageAdmins           |      ✅     |       ❌       |       ❌      |
 * | canApproveAcademicResources |    ✅     |       ✅       |       ❌      |
 * | canAccessFinance          |      ✅     |       ❌       |       ✅      |
 * | canViewAuditLogs          |      ✅     |       ❌       |       ❌      |
 * | canRestoreDeletedData     |      ✅     |       ❌       |       ❌      |
 * | canManageSystemSettings   |      ✅     |       ❌       |       ❌      |
 *
 * Super Admin automatically has ALL permissions.
 *
 * IMPORTANT: Only `access_status = 'approved'` roles grant permissions.
 * Pending / suspended / revoked roles are inert.
 *
 * @module services/admin/permissionService
 */

import type {
  AdminPermission,
  AdminRole,
  AdminRoleAssignment,
} from '@/types/adminRoles';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the subset of roles that are currently APPROVED.
 */
function approvedRoles(roles: AdminRoleAssignment[] | null | undefined): AdminRoleAssignment[] {
  return (roles ?? []).filter((r) => r.accessStatus === 'approved');
}

/**
 * True when the approved roles include the given role.
 */
function hasRole(roles: AdminRoleAssignment[] | null | undefined, role: AdminRole): boolean {
  return approvedRoles(roles).some((r) => r.adminRole === role);
}

/**
 * True when the approved roles include ANY of the given roles.
 */
function hasAnyRole(
  roles: AdminRoleAssignment[] | null | undefined,
  wanted: AdminRole[],
): boolean {
  const approved = approvedRoles(roles);
  return approved.some((r) => wanted.includes(r.adminRole));
}

// ─── Direct role checks ─────────────────────────────────────────────────────

/** True when the user holds an approved super_admin role. */
export function isSuperAdmin(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return hasRole(roles, 'super_admin');
}

/** True when the user holds an approved academic_admin role. */
export function isAcademicAdmin(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return hasRole(roles, 'academic_admin');
}

/** True when the user holds an approved finance_admin role. */
export function isFinanceAdmin(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return hasRole(roles, 'finance_admin');
}

/** True when the user holds ANY approved admin role. */
export function isAnyAdmin(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return approvedRoles(roles).length > 0;
}

// ─── Permission helpers ─────────────────────────────────────────────────────

/**
 * Super Admin capability: grant/revoke/suspend/reactivate admin roles,
 * manage all admins, manage teachers, manage students, manage institutes,
 * delete anything and restore deleted data, view audit logs, system settings.
 */
export function canManageAdmins(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return hasRole(roles, 'super_admin');
}

/**
 * Academic capability: receive and act on all approval requests
 * (questions, PYQs, mock tests, content, live classes) and manage academic
 * resources. Granted to super_admin and academic_admin.
 */
export function canApproveAcademicResources(
  roles: AdminRoleAssignment[] | null | undefined,
): boolean {
  return hasAnyRole(roles, ['super_admin', 'academic_admin']);
}

/**
 * Finance capability: transactions, purchases, revenue, refunds, coupons,
 * invoices, financial reports. Granted to super_admin and finance_admin.
 */
export function canAccessFinance(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return hasAnyRole(roles, ['super_admin', 'finance_admin']);
}

/** Super Admin only: read audit logs. */
export function canViewAuditLogs(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return hasRole(roles, 'super_admin');
}

/** Super Admin only: restore soft-deleted data. */
export function canRestoreDeletedData(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return hasRole(roles, 'super_admin');
}

/** Super Admin only: modify system settings. */
export function canManageSystemSettings(roles: AdminRoleAssignment[] | null | undefined): boolean {
  return hasRole(roles, 'super_admin');
}

// ─── Programmatic check ─────────────────────────────────────────────────────

/**
 * Resolve a named capability against the user's admin roles.
 *
 * Useful for feature flags and data-driven UI where the permission name is
 * stored/selected dynamically.
 *
 * @example
 * ```ts
 * if (checkPermission(adminRoles, 'canAccessFinance')) { ... }
 * ```
 */
export function checkPermission(
  roles: AdminRoleAssignment[] | null | undefined,
  permission: AdminPermission,
): boolean {
  switch (permission) {
    case 'manageAdmins':
      return canManageAdmins(roles);
    case 'approveAcademicResources':
      return canApproveAcademicResources(roles);
    case 'accessFinance':
      return canAccessFinance(roles);
    case 'viewAuditLogs':
      return canViewAuditLogs(roles);
    case 'restoreDeletedData':
      return canRestoreDeletedData(roles);
    case 'manageSystemSettings':
      return canManageSystemSettings(roles);
    default:
      return false;
  }
}

// ─── Namespaced object (matches existing service conventions) ───────────────

/**
 * Namespaced permission helper object.
 *
 * Consumers can import the object form:
 * ```ts
 * import { permission } from '@/services/admin/permissionService';
 * permission.canApproveAcademicResources(user.adminRoles);
 * ```
 */
export const permission = {
  isSuperAdmin,
  isAcademicAdmin,
  isFinanceAdmin,
  isAnyAdmin,
  canManageAdmins,
  canApproveAcademicResources,
  canAccessFinance,
  canViewAuditLogs,
  canRestoreDeletedData,
  canManageSystemSettings,
  checkPermission,
};
