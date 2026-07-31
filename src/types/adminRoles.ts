/**
 * Admin Roles Types
 *
 * Type definitions for the Admin Roles architecture (Domain 18).
 *
 * Mirrors the PostgreSQL schema created in migration 074:
 *   - `admin_roles` table
 *   - `admin_role` enum (super_admin | academic_admin | finance_admin)
 *   - `admin_access_status` enum (pending | approved | suspended | revoked)
 *
 * Every profile with `profiles.role = 'admin'` may hold one or more admin
 * roles. A profile can hold multiple admin roles; each (profile_id,
 * admin_role) pair is unique.
 *
 * @module types/adminRoles
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

/**
 * The specific type of admin a profile holds.
 *
 * - `super_admin`:    Full system access — manage admins, teachers, students,
 *                     institutes; view everything; delete/restore; audit logs;
 *                     system settings.
 * - `academic_admin`: Receives approval requests (questions, PYQs, mock tests,
 *                     content, live classes); manages academic resources.
 *                     Cannot access finance.
 * - `finance_admin`:  Transactions, purchases, revenue, refunds, coupons,
 *                     invoices, financial reports. Cannot manage academic
 *                     content.
 *
 * Mirrors the `admin_role` PostgreSQL enum.
 */
export type AdminRole = 'super_admin' | 'academic_admin' | 'finance_admin';

/**
 * Lifecycle state of an admin role assignment.
 *
 * - `pending`:   Awaiting super admin approval (e.g. finance admin OTP flow).
 * - `approved`:  Active. The role grants its permissions.
 * - `suspended`: Temporarily disabled. Reversible via reactivation.
 * - `revoked`:   Permanently removed.
 *
 * Mirrors the `admin_access_status` PostgreSQL enum.
 */
export type AdminAccessStatus = 'pending' | 'approved' | 'suspended' | 'revoked';

// ─── Database Shape ─────────────────────────────────────────────────────────

/**
 * Mirrors a row of the `admin_roles` table.
 *
 * snake_case columns are mapped to camelCase properties for consumers.
 */
export interface DbAdminRole {
  admin_role_id: string;
  profile_id: string;
  institute_id: string;
  admin_role: AdminRole;
  access_status: AdminAccessStatus;
  granted_by: string | null;
  access_granted_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Public Shapes ──────────────────────────────────────────────────────────

/**
 * An admin role assignment as consumed by the application.
 *
 * Attached to `UserProfile.adminRoles` during login for admin users so that
 * permission helpers and UI can resolve access without extra round-trips.
 */
export interface AdminRoleAssignment {
  /** PK of the admin_roles row. */
  adminRoleId: string;
  /** The profile holding the role. */
  profileId: string;
  /** Institute scope (denormalized for RLS). */
  instituteId: string;
  /** The specific admin role. */
  adminRole: AdminRole;
  /** Lifecycle state. */
  accessStatus: AdminAccessStatus;
  /** Super admin who granted/approved the role. Null for system backfill. */
  grantedBy: string | null;
  /** UTC timestamp when access was approved. Null while pending. */
  accessGrantedAt: string | null;
  /** UTC timestamp of row creation. */
  createdAt: string;
  /** UTC timestamp of last modification. */
  updatedAt: string;
}

/**
 * An admin user (profile with role = 'admin') with their resolved roles.
 *
 * Returned by `adminRoleService.listAdminUsers()`.
 */
export interface AdminUser {
  profileId: string;
  instituteId: string;
  name: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  accountStatus: string;
  createdAt: string;
  /** Institute display name (resolved from institutes). Null when unknown. */
  instituteName: string | null;
  /** Name of the super admin who granted the most recent role. Null when unknown. */
  grantedByName: string | null;
  /** All role assignments for this profile (any access_status). */
  roles: AdminRoleAssignment[];
}

// ─── Permissions ────────────────────────────────────────────────────────────

/**
 * Named capabilities resolved from a profile's approved admin roles.
 *
 * These are consumed by the permission helpers in `permissionService.ts`
 * and, later, by frontend guards.
 */
export type AdminPermission =
  | 'manageAdmins'
  | 'approveAcademicResources'
  | 'accessFinance'
  | 'viewAuditLogs'
  | 'restoreDeletedData'
  | 'manageSystemSettings';

// ─── Input DTOs ─────────────────────────────────────────────────────────────

/**
 * Input required to grant an admin role to a profile.
 */
export interface GrantAdminRoleInput {
  /** The profile to grant the role to (must have profiles.role = 'admin'). */
  profileId: string;
  /** The role to grant. */
  adminRole: AdminRole;
}

/**
 * Result of a grant operation.
 */
export interface GrantAdminRoleResult {
  granted: boolean;
  /** True when the role already existed for this profile. */
  existing: boolean;
  /** The created/updated assignment (when available). */
  assignment?: AdminRoleAssignment;
}

/**
 * Input required to create a new admin account from the Admin Management
 * module (super admin only).
 *
 * The workflow creates: (1) an auth user, (2) a profile with role =
 * 'admin' (via the `handle_new_user` trigger), and (3) an `admin_roles`
 * row with `access_status = 'approved'`.
 *
 * Super admins cannot be created through this flow — only academic and
 * finance admins (the two roles a super admin grants).
 */
export interface CreateAdminInput {
  /** Full name of the new admin. */
  name: string;
  /** Optional email. Phone is the primary auth identifier. */
  email?: string;
  /** Phone in E.164 format (e.g. +919876543210). */
  phone: string;
  /** Password (min 6 characters). */
  password: string;
  /** The role to grant. Super admin creation is intentionally not exposed. */
  adminRole: Exclude<AdminRole, 'super_admin'>;
}

/**
 * Result of a successful `createAdmin` call.
 *
 * Returned by the `admin-identity-create` edge function (which creates the
 * auth user via the Supabase Admin API using the service role) and mapped
 * back by `adminRoleService.createAdmin()`.
 */
export interface CreateAdminResult {
  /** The auth.users.id of the newly created account. */
  adminId: string;
  /** The profile id (= auth.users.id by design of this app). */
  profileId: string;
  /** The granted admin role. */
  adminRole: AdminRole;
  /** Always 'approved' for newly created admins. */
  accessStatus: AdminAccessStatus;
}
