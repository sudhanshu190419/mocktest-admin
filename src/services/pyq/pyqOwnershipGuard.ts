/**
 * PYQ Ownership Guard
 *
 * Shared service-layer authorization helpers for the PYQ module (Phase 9B).
 *
 * ## Why this exists
 *
 * Phase 9B splits PYQ responsibilities:
 *
 *   • PYQ **packages** are institute-owned and their mutations are restricted
 *     to Super Admin only.
 *   • PYQ **papers** are teacher-owned (`pyq_papers.created_by` == the
 *     creating profile) and may only be modified by their owner, with a
 *     Super Admin override.
 *
 * Ownership must NEVER be trusted from client data — it is always resolved
 * server-side from the authenticated session and the database row.
 *
 * ## Usage
 *
 * ```ts
 * // Super Admin-only mutation (packages):
 * if (!(await isCurrentUserSuperAdmin())) {
 *   return { success: false, error: 'Only a Super Admin can ...' };
 * }
 *
 * // Paper ownership check (papers, mappings, mock generation):
 * const guard = await assertPaperOwnership(paperId);
 * if (!guard.success) return guard;
 * ```
 *
 * @module services/pyq/pyqOwnershipGuard
 */

import { supabase } from '@/config/supabase';
import { adminRoleService } from '@/services/admin/adminRoleService';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ─── Identity helpers ───────────────────────────────────────────────────────

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
 * True when the current user holds an APPROVED super_admin role.
 *
 * Resolves live from `admin_roles` via `adminRoleService` — never from
 * client-supplied values (mirrors `approvalGuard.ts`).
 */
export async function isCurrentUserSuperAdmin(): Promise<boolean> {
  return adminRoleService.isSuperAdmin();
}

// ─── Paper ownership ────────────────────────────────────────────────────────

/**
 * Verifies the current user may manage the given PYQ paper.
 *
 * Allowed when:
 *   • the caller is an approved Super Admin (override), OR
 *   • the paper's `created_by` equals the caller's profile id (owner).
 *
 * The paper's `created_by` is read from the database — never from client
 * input. Returns a standard `ApiResponse` so callers can short-circuit:
 *
 * ```ts
 * const guard = await assertPaperOwnership(paperId);
 * if (!guard.success) return guard;
 * ```
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

    // Super Admin override — bypasses ownership entirely.
    if (await isCurrentUserSuperAdmin()) {
      return {
        success: true,
        data: { paperId, createdBy: null, profileId },
      };
    }

    const { data, error } = await supabase
      .from('pyq_papers')
      .select('created_by')
      .eq('paper_id', paperId)
      .maybeSingle<{ created_by: string | null }>();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }
    if (!data) {
      return { success: false, error: `PYQ paper not found: ${paperId}` };
    }

    if (data.created_by === profileId) {
      return {
        success: true,
        data: { paperId, createdBy: data.created_by, profileId },
      };
    }

    return {
      success: false,
      error:
        'You do not have permission to modify this PYQ paper. ' +
        'Only the paper owner or a Super Admin can perform this action.',
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
