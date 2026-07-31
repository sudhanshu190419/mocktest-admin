/**
 * Approval Permission Guard
 *
 * Shared service-layer guard for academic approval operations.
 *
 * Every approval mutation (approve / reject / publish / unpublish / archive /
 * restore / reopen / assign reviewer) verifies the current user holds the
 * `canApproveAcademicResources` permission BEFORE executing. This closes the
 * backend authorization gap: a Finance Admin (or Teacher / Student) can no
 * longer bypass the frontend and directly invoke approval operations.
 *
 * Permission model (unchanged — see permissionService):
 *   super_admin     → ✅ can approve academic resources
 *   academic_admin  → ✅ can approve academic resources
 *   finance_admin   → ❌ denied
 *   teacher/student → ❌ denied
 *
 * @module services/admin/approvalGuard
 */

import { adminRoleService } from './adminRoleService';
import type { ApiResponse } from '@/types/academic';

/**
 * True when the current user holds an APPROVED super_admin or academic_admin
 * role (i.e. the `canApproveAcademicResources` permission).
 *
 * Resolves roles live from `admin_roles` via `adminRoleService` — never from
 * client-supplied values.
 */
export async function canApproveAcademicResources(): Promise<boolean> {
  return adminRoleService.hasPermission('approveAcademicResources');
}

/**
 * Standard authorization-denied response for approval operations.
 *
 * Deliberately generic — never leaks implementation details or whether the
 * caller is a finance admin, teacher, or student. The generic parameter
 * allows this to be returned from any approval method regardless of its
 * success payload type (the `data` field is simply omitted).
 */
export function approvalPermissionDenied<T = never>(): ApiResponse<T> {
  return {
    success: false,
    error:
      'You do not have permission to approve academic resources. ' +
      'Only a Super Admin or Academic Admin can perform approval actions.',
  };
}
