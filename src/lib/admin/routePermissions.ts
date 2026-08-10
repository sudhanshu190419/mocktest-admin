/**
 * Admin Route Permissions
 *
 * Single source of truth mapping admin routes to the permission required
 * to access them. Consumed by:
 *   - `AdminSidebar` (hide menu items without permission)
 *   - `AdminRouteGuard` (redirect when a restricted URL is entered directly)
 *   - `PermissionGuard` (conditional rendering)
 *
 * ## Configurability
 *
 * This matrix is intentionally data-driven — client requirements may change
 * later. Adjust the `permission` value for any route here and both the
 * sidebar and the route guard update automatically. Do NOT hardcode role
 * names in components; always resolve through `permissionService`.
 *
 * ## Permission model
 *
 * A `permission` value maps to one of the permissionService helpers:
 *   - 'manageAdmins'             → super_admin
 *   - 'approveAcademicResources' → super_admin | academic_admin
 *   - 'accessFinance'            → super_admin | finance_admin
 *   - 'viewAuditLogs'            → super_admin
 *   - 'restoreDeletedData'       → super_admin
 *   - 'manageSystemSettings'     → super_admin
 *
 * Routes WITHOUT a permission value are visible to every admin
 * (e.g. Dashboard, Notifications, Reports).
 *
 * @module lib/admin/routePermissions
 */

import type { AdminPermission } from '@/types/adminRoles';

// ─── Matrix ─────────────────────────────────────────────────────────────────

export interface AdminRoutePermission {
  /** Route prefix — matched via pathname === prefix || pathname.startsWith(prefix + '/'). */
  prefix: string;
  /**
   * Permission required to access this route.
   * `undefined` (omitted) = any admin can access.
   */
  permission?: AdminPermission;
}

/**
 * The permission matrix. Longest matching prefix wins, so specific routes
 * override broader ones (add more specific entries ABOVE broader ones).
 */
export const adminRoutePermissions: AdminRoutePermission[] = [
  // ── Core (every admin) ────────────────────────────────────────────────
  { prefix: '/admin' }, // Dashboard
  { prefix: '/admin/notifications' },
  { prefix: '/admin/reports' },

  // ── Academic management (super + academic) ────────────────────────────
  { prefix: '/admin/teachers', permission: 'approveAcademicResources' },
  { prefix: '/admin/students', permission: 'approveAcademicResources' },
  { prefix: '/admin/attendance', permission: 'approveAcademicResources' },
  { prefix: '/admin/batches', permission: 'approveAcademicResources' },
  { prefix: '/admin/courses', permission: 'approveAcademicResources' },
  { prefix: '/admin/content', permission: 'approveAcademicResources' },
  { prefix: '/admin/demo-classes', permission: 'approveAcademicResources' },
  { prefix: '/admin/timetable', permission: 'approveAcademicResources' },
  { prefix: '/admin/academic', permission: 'approveAcademicResources' },
  { prefix: '/admin/questions', permission: 'approveAcademicResources' },
  { prefix: '/admin/mock-tests', permission: 'approveAcademicResources' },
  { prefix: '/admin/approval-workspace', permission: 'approveAcademicResources' },
  { prefix: '/admin/approvals', permission: 'approveAcademicResources' },

  // ── Commerce (super + finance) ────────────────────────────────────────
  { prefix: '/admin/commerce', permission: 'accessFinance' },

  // ── Super admin only ──────────────────────────────────────────────────
  { prefix: '/admin/admin-management', permission: 'manageAdmins' },
  { prefix: '/admin/devices', permission: 'manageAdmins' },
  { prefix: '/admin/pyq-packages', permission: 'manageAdmins' },
  { prefix: '/admin/audit-logs', permission: 'viewAuditLogs' },
  { prefix: '/admin/trash', permission: 'restoreDeletedData' },
  { prefix: '/admin/settings', permission: 'manageSystemSettings' },
];

// ─── Resolver ───────────────────────────────────────────────────────────────

/**
 * Resolve the permission required for a given pathname.
 *
 * Longest matching prefix wins. Returns `undefined` when the route is
 * accessible to every admin.
 *
 * @param pathname - e.g. `/admin/teachers/abc-123`
 * @returns The required AdminPermission, or undefined for open routes.
 */
export function getRequiredPermission(pathname: string): AdminPermission | undefined {
  let bestMatch: AdminRoutePermission | undefined;

  for (const entry of adminRoutePermissions) {
    const isMatch =
      pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`);

    if (isMatch && (!bestMatch || entry.prefix.length > bestMatch.prefix.length)) {
      bestMatch = entry;
    }
  }

  return bestMatch?.permission;
}
