/**
 * Auth Routing Helper
 *
 * Single-source-of-truth for determining where a user should be redirected
 * after authentication, based on their role and account_status.
 *
 * This is the ONLY place where the role × accountStatus routing matrix is
 * defined. Every route guard, layout, and redirect should call this function
 * instead of duplicating the logic.
 *
 * @module lib/auth/routing
 */

// ─── Routing Matrix ─────────────────────────────────────────────────────────
//
//   Role       | accountStatus | Destination
//   -----------+---------------+-----------------
//   admin      | any           → /admin
//   teacher    | approved      → /teacher
//   teacher    | pending       → /pending-approval
//   teacher    | rejected      → /account-rejected
//   teacher    | suspended     → /account-suspended
//   teacher    | inactive      → /account-inactive
//   student    | *             → / (not in this phase)
//   unknown    | *             → / (fallback)
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the post-login destination route based on the user's role and
 * account status.
 *
 * @param role        - The user's role from profiles.role.
 * @param accountStatus - The user's account lifecycle status from
 *                        profiles.account_status. Defaults to 'approved'
 *                        for backward compatibility.
 * @returns The absolute path the user should be redirected to.
 */
export function getPostLoginDestination(
  role: string,
  accountStatus?: string,
): string {
  const status = accountStatus ?? 'approved';

  // ── Admin ────────────────────────────────────────────────────────────────
  if (role === 'admin') {
    return '/admin';
  }

  // ── Teacher ──────────────────────────────────────────────────────────────
  if (role === 'teacher') {
    switch (status) {
      case 'approved':
        return '/teacher';
      case 'pending':
        return '/pending-approval';
      case 'rejected':
        return '/account-rejected';
      case 'suspended':
        return '/account-suspended';
      case 'inactive':
        return '/account-inactive';
      default:
        // Unknown status — safe fallback
        return '/teacher';
    }
  }

  // ── Student / Unknown ────────────────────────────────────────────────────
  // Student routing is not part of this phase. Fall back to root.
  return '/';
}

/**
 * Returns a human-readable label for the account status.
 *
 * Useful for displaying the user's current status in profile screens,
 * admin dashboards, etc.
 */
export function getAccountStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending Approval';
    case 'approved':
      return 'Active';
    case 'rejected':
      return 'Not Approved';
    case 'suspended':
      return 'Suspended';
    case 'inactive':
      return 'Inactive';
    default:
      return 'Unknown';
  }
}
