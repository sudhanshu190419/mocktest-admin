/**
 * PYQ Ownership Guard
 *
 * Shared service-layer authorization helpers for the PYQ module.
 *
 * ## Role Model
 *
 * - PYQ **packages**, **papers**, and **mappings** are managed strictly by
 *   **Super Admin** and **Academic Admin** within their institute.
 * - **Finance Admin** is restricted to commerce/purchases and has zero
 *   academic package/paper mutation rights.
 * - **Teachers** have NO management access to PYQ packages or papers.
 * - **Students** have read-only consumption access upon valid purchase.
 *
 * Ownership must NEVER be trusted from client data — it is always resolved
 * server-side from the authenticated session and admin_roles.
 *
 * @module services/pyq/pyqOwnershipGuard
 */

import { supabase } from '@/config/supabase';
import { adminRoleService } from '@/services/admin/adminRoleService';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ─── Identity & Role Helpers ────────────────────────────────────────────────

/**
 * Resolves the current authenticated user's profile id
 * (`profiles.profile_id` == `auth.users.id`).
 *
 * Returns `null` when there is no authenticated session.
 */
export async function resolveCurrentProfileId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * True when the current user holds an APPROVED super_admin or academic_admin role.
 *
 * Resolves live from `admin_roles` via `adminRoleService` — never from
 * client-supplied values.
 */
export async function canManagePyq(): Promise<boolean> {
  const roles = await adminRoleService.getCurrentAdminRoles();
  if (!roles.success) return false;
  return (roles.data ?? []).some(
    (r) =>
      (r.adminRole === 'super_admin' || r.adminRole === 'academic_admin') &&
      r.accessStatus === 'approved',
  );
}

/**
 * Backward-compatible helper for Super Admin checks.
 */
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  return adminRoleService.isSuperAdmin();
}

// ─── Paper Management Authorization ──────────────────────────────────────────

/**
 * Verifies the current user may manage the given PYQ paper.
 *
 * Allowed strictly when:
 *   • the caller is an approved Super Admin OR Academic Admin.
 *
 * Under the target authorization model, teachers have NO management access
 * to PYQ papers, question mappings, or mock mappings.
 *
 * @param paperId - The `pyq_papers.paper_id` to authorize against.
 */
export async function assertPaperOwnership(
  paperId: string,
): Promise<
  ApiResponse<{
    paperId: string;
    createdBy: string | null;
    profileId: string | null;
  }>
> {
  try {
    validateUUID(paperId, 'paperId');

    const profileId = await resolveCurrentProfileId();
    if (!profileId) {
      return { success: false, error: 'No authenticated user found.' };
    }

    if (await canManagePyq()) {
      return {
        success: true,
        data: { paperId, createdBy: null, profileId },
      };
    }

    return {
      success: false,
      error:
        'You do not have permission to modify this PYQ paper. ' +
        'Only a Super Admin or Academic Admin can manage PYQ papers.',
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
