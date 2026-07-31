/**
 * Admin Role Service
 *
 * Backend support for the Admin Roles architecture (Domain 18, migration 074).
 *
 * Manages the `admin_roles` table and exposes role checks for the current
 * user. Every public method returns a standardised `ApiResponse<T>` shape,
 * matching the existing admin service conventions.
 *
 * ## Business rules
 *
 * - A profile can hold a specific admin role at most once (unique constraint).
 * - New grants start as `pending`; a super admin approves them (the finance
 *   admin OTP flow in a later phase). `grantAdminRole` creates the row; the
 *   status transition is handled by `reactivateAdminRole` (pending → approved).
 * - Granting a role that already exists is a no-op (unique constraint 23505).
 * - Revoke sets `access_status = 'revoked'` (soft removal, preserves audit).
 * - Suspend sets `access_status = 'suspended'` (reversible).
 * - Reactivate sets `access_status = 'approved'` and refreshes
 *   `access_granted_at` (re-approval).
 *
 * ## Authorization
 *
 * Only super admins may list admins and manage roles (mirrors the RLS policy
 * "Super admins can manage admin_roles"). Every admin may read their own
 * assignments. The service also performs an explicit permission pre-check so
 * callers get a clean error before hitting RLS.
 *
 * @module services/admin/adminRoleService
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/config/supabase';
import { extractErrorMessage, validateUUID } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';
import type {
  AdminAccessStatus,
  AdminPermission,
  AdminRole,
  AdminRoleAssignment,
  AdminUser,
  CreateAdminInput,
  CreateAdminResult,
  DbAdminRole,
  GrantAdminRoleInput,
  GrantAdminRoleResult,
} from '@/types/adminRoles';
import { checkPermission } from './permissionService';
import { auditService } from '@/services/audit/auditService';

// ─── Edge Function helpers ───────────────────────────────────────────────────

/**
 * Extract a user-friendly error message from a `supabase.functions.invoke`
 * failure.
 *
 * The `admin-identity-create` edge function returns JSON bodies shaped as
 * `{ success: false, error: string }`. When the function responds with a
 * non-2xx status, supabase-js surfaces it as a `FunctionsHttpError` whose
 * `context` is the raw Response — we read the JSON body to recover the
 * server's validation/authorization message.
 *
 * @param error  The error object returned by `functions.invoke`.
 * @returns The server-provided message when available, else the raw error.
 */
async function extractFunctionsErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string };
      if (body?.error) {
        return body.error;
      }
    } catch {
      // Body was not JSON — fall through to the raw message.
    }
  }
  return extractErrorMessage(error);
}

// ─── Mapping ────────────────────────────────────────────────────────────────

function mapDbAdminRole(row: DbAdminRole): AdminRoleAssignment {
  return {
    adminRoleId: row.admin_role_id,
    profileId: row.profile_id,
    instituteId: row.institute_id,
    adminRole: row.admin_role,
    accessStatus: row.access_status,
    grantedBy: row.granted_by,
    accessGrantedAt: row.access_granted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Service ────────────────────────────────────────────────────────────────

export const adminRoleService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Get Current Admin Roles
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get all admin role assignments for the current authenticated user.
   *
   * RLS permits any admin to read their own admin_roles rows. Returns an
   * empty array for non-admins (they have no rows).
   */
  async getCurrentAdminRoles(): Promise<ApiResponse<AdminRoleAssignment[]>> {
    try {
      // Resolve the current user explicitly. This is REQUIRED: the RLS policy
      // "Super admins can manage admin_roles" is `for all` (includes SELECT),
      // so an unfiltered query would return EVERY role in the institute and
      // make isAcademicAdmin()/isFinanceAdmin()/isAnyAdmin() report roles the
      // current user does not hold.
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id;

      if (!currentUserId) {
        return { success: false, error: 'No authenticated user found.' };
      }

      const { data, error } = await supabase
        .from('admin_roles')
        .select('*')
        .eq('profile_id', currentUserId)
        .order('created_at', { ascending: true });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: (data as DbAdminRole[] | null ?? []).map(mapDbAdminRole),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Current-user role checks
  // ─────────────────────────────────────────────────────────────────────────

  /** True when the current user holds an APPROVED super_admin role. */
  async isSuperAdmin(): Promise<boolean> {
    const result = await this.getCurrentAdminRoles();
    if (!result.success) return false;
    return (result.data ?? []).some(
      (r) => r.adminRole === 'super_admin' && r.accessStatus === 'approved',
    );
  },

  /** True when the current user holds an APPROVED academic_admin role. */
  async isAcademicAdmin(): Promise<boolean> {
    const result = await this.getCurrentAdminRoles();
    if (!result.success) return false;
    return (result.data ?? []).some(
      (r) => r.adminRole === 'academic_admin' && r.accessStatus === 'approved',
    );
  },

  /** True when the current user holds an APPROVED finance_admin role. */
  async isFinanceAdmin(): Promise<boolean> {
    const result = await this.getCurrentAdminRoles();
    if (!result.success) return false;
    return (result.data ?? []).some(
      (r) => r.adminRole === 'finance_admin' && r.accessStatus === 'approved',
    );
  },

  /** True when the current user holds ANY approved admin role. */
  async isAnyAdmin(): Promise<boolean> {
    const result = await this.getCurrentAdminRoles();
    if (!result.success) return false;
    return (result.data ?? []).some((r) => r.accessStatus === 'approved');
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. List Admin Users
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List admin users (profiles with role = 'admin') with their roles,
   * scoped to an institute.
   *
   * Super admin only.
   *
   * @param instituteId - Institute scope for the listing.
   * @param search      - Optional search across name, email and phone.
   */
  async listAdminUsers(
    instituteId: string,
    search?: string,
  ): Promise<ApiResponse<AdminUser[]>> {
    try {
      validateUUID(instituteId, 'instituteId');

      // Permission pre-check (RLS also enforces this). Without this gate a
      // non-super admin would receive ALL admin profiles but only their own
      // admin_roles rows (RLS) — misleading partial data.
      if (!(await this.isSuperAdmin())) {
        return {
          success: false,
          error: 'Only a super admin can list admin users.',
        };
      }

      const { data: profileRows, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'admin')
        .eq('institute_id', instituteId);

      if (profileErr) {
        return { success: false, error: extractErrorMessage(profileErr) };
      }

      // Fetch roles for all these profiles in one query
      const profileIds = (profileRows ?? []).map((p: any) => p.profile_id);

      let roleRows: DbAdminRole[] = [];
      if (profileIds.length > 0) {
        const { data: roleData, error: roleErr } = await supabase
          .from('admin_roles')
          .select('*')
          .in('profile_id', profileIds)
          .order('created_at', { ascending: true });

        if (roleErr) {
          return { success: false, error: extractErrorMessage(roleErr) };
        }
        roleRows = (roleData as DbAdminRole[] | null) ?? [];
      }

      const rolesByProfile = new Map<string, AdminRoleAssignment[]>();
      for (const row of roleRows) {
        const list = rolesByProfile.get(row.profile_id) ?? [];
        list.push(mapDbAdminRole(row));
        rolesByProfile.set(row.profile_id, list);
      }

      let users: AdminUser[] = (profileRows ?? []).map((p: any) => ({
        profileId: p.profile_id,
        instituteId: p.institute_id,
        name: p.name,
        email: p.email,
        phone: p.phone ?? null,
        avatarUrl: p.avatar_url ?? null,
        isActive: p.is_active,
        accountStatus: p.account_status ?? 'approved',
        createdAt: p.created_at,
        instituteName: null,
        grantedByName: null,
        roles: rolesByProfile.get(p.profile_id) ?? [],
      }));

      // Resolve the institute display name (single query for the listing)
      const { data: instituteRow } = await supabase
        .from('institutes')
        .select('name')
        .eq('institute_id', instituteId)
        .maybeSingle();
      const instituteName = instituteRow?.name ?? null;

      // Resolve granter display names (all distinct granted_by ids at once)
      const granterIds = Array.from(
        new Set(
          roleRows
            .map((r) => r.granted_by)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const granterNameById = new Map<string, string>();
      if (granterIds.length > 0) {
        const { data: granterRows } = await supabase
          .from('profiles')
          .select('profile_id, name')
          .in('profile_id', granterIds);
        (granterRows ?? []).forEach((g: any) => {
          granterNameById.set(g.profile_id, g.name);
        });
      }

      for (const user of users) {
        user.instituteName = instituteName;
        // Prefer the most recently granted role for the "granted by" display
        const lastRole = user.roles[user.roles.length - 1];
        user.grantedByName =
          lastRole?.grantedBy && granterNameById.has(lastRole.grantedBy)
            ? granterNameById.get(lastRole.grantedBy) ?? null
            : null;
      }

      if (search?.trim()) {
        const term = search.trim().toLowerCase();
        users = users.filter(
          (u) =>
            u.name.toLowerCase().includes(term) ||
            u.email.toLowerCase().includes(term) ||
            (u.phone ?? '').toLowerCase().includes(term),
        );
      }

      return { success: true, data: users };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Grant Admin Role
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Grant an admin role to a profile.
   *
   * Super admin only. Creates the admin_roles row with access_status =
   * 'pending'. The unique constraint makes duplicate grants a no-op.
   *
   * @param input - profileId + adminRole.
   */
  async grantAdminRole(
    input: GrantAdminRoleInput,
  ): Promise<ApiResponse<GrantAdminRoleResult>> {
    try {
      validateUUID(input.profileId, 'profileId');

      // Permission pre-check (RLS also enforces this)
      if (!(await this.isSuperAdmin())) {
        return {
          success: false,
          error: 'Only a super admin can grant admin roles.',
        };
      }

      // Resolve institute_id from the target profile (RLS compliance)
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('profile_id, institute_id')
        .eq('profile_id', input.profileId)
        .single();

      if (profileErr || !profile) {
        return { success: false, error: 'Profile not found.' };
      }

      // Current user's profile id is the granter
      const { data: userData } = await supabase.auth.getUser();
      const grantedBy = userData.user?.id ?? null;

      const { data, error } = await supabase
        .from('admin_roles')
        .insert({
          profile_id: input.profileId,
          institute_id: profile.institute_id,
          admin_role: input.adminRole,
          access_status: 'pending',
          granted_by: grantedBy,
          access_granted_at: null,
        })
        .select('*')
        .single();

      if (error) {
        if (error.code === '23505') {
          // Role already exists for this profile — not an error
          return {
            success: true,
            data: { granted: false, existing: true },
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: admin role granted ────────────────────────────────────
      const granted = mapDbAdminRole(data as DbAdminRole);
      await auditService.logGrant(
        {
          resourceType: 'admin_roles',
          resourceId: granted.adminRoleId,
          metadata: {
            profileId: input.profileId,
            adminRole: input.adminRole,
            grantedBy,
            accessStatus: 'pending',
          },
        },
        { strict: true },
      );

      return {
        success: true,
        data: { granted: true, existing: false, assignment: granted },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. Revoke Admin Role
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Revoke an admin role (soft removal — sets access_status = 'revoked').
   *
   * Super admin only. The row is preserved for audit purposes.
   *
   * @param adminRoleId - The `admin_roles.admin_role_id`.
   */
  async revokeAdminRole(adminRoleId: string): Promise<ApiResponse<void>> {
    try {
      validateUUID(adminRoleId, 'adminRoleId');

      if (!(await this.isSuperAdmin())) {
        return {
          success: false,
          error: 'Only a super admin can revoke admin roles.',
        };
      }

      const { error } = await supabase
        .from('admin_roles')
        .update({ access_status: 'revoked' })
        .eq('admin_role_id', adminRoleId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: admin role revoked ────────────────────────────────────
      await auditService.logRevoke(
        {
          resourceType: 'admin_roles',
          resourceId: adminRoleId,
          metadata: { adminRoleId, accessStatus: 'revoked' },
        },
        { strict: true },
      );

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  6. Suspend Admin Role
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Suspend an admin role (temporarily disabled — reversible).
   *
   * Super admin only.
   *
   * @param adminRoleId - The `admin_roles.admin_role_id`.
   */
  async suspendAdminRole(adminRoleId: string): Promise<ApiResponse<void>> {
    try {
      validateUUID(adminRoleId, 'adminRoleId');

      if (!(await this.isSuperAdmin())) {
        return {
          success: false,
          error: 'Only a super admin can suspend admin roles.',
        };
      }

      const { error } = await supabase
        .from('admin_roles')
        .update({ access_status: 'suspended' })
        .eq('admin_role_id', adminRoleId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: admin role suspended ──────────────────────────────────
      await auditService.logSuspend(
        {
          resourceType: 'admin_roles',
          resourceId: adminRoleId,
          metadata: { adminRoleId, accessStatus: 'suspended' },
        },
        { strict: true },
      );

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  7. Reactivate Admin Role
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Reactivate an admin role (approved) — also used to approve a pending
   * grant. Refreshes access_granted_at to now().
   *
   * Super admin only.
   *
   * @param adminRoleId - The `admin_roles.admin_role_id`.
   */
  async reactivateAdminRole(adminRoleId: string): Promise<ApiResponse<void>> {
    try {
      validateUUID(adminRoleId, 'adminRoleId');

      if (!(await this.isSuperAdmin())) {
        return {
          success: false,
          error: 'Only a super admin can reactivate admin roles.',
        };
      }

      const { error } = await supabase
        .from('admin_roles')
        .update({
          access_status: 'approved',
          access_granted_at: new Date().toISOString(),
        })
        .eq('admin_role_id', adminRoleId);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      // ── Audit: admin role reactivated ────────────────────────────────
      await auditService.logReactivate(
        {
          resourceType: 'admin_roles',
          resourceId: adminRoleId,
          metadata: { adminRoleId, accessStatus: 'approved' },
        },
        { strict: true },
      );

      return { success: true };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  8. Create Admin (auth user + profile + approved role)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new admin account in one logical workflow, executed securely
   * by the `admin-identity-create` edge function.
   *
   * The browser NEVER calls `supabase.auth.signUp()` for admin creation.
   * Instead it invokes the edge function, which uses the Supabase Admin API
   * (service role — never exposed to the browser) to:
   *
   *   1. Verify the caller is an approved super admin (from `admin_roles`,
   *      not from any client-supplied role value).
   *   2. Validate name / phone / email / role (rejects super_admin).
   *   3. Create the auth user with `phone_confirm` + `email_confirm` so the
   *      account is immediately usable with phone-first password login.
   *      `user_metadata { role: 'admin', institute_id }` drives the
   *      `handle_new_user` trigger (migration 027) to create the profile.
   *   4. Wait for the trigger-created profile (poll, never duplicate).
   *   5. Insert the `admin_roles` row with `access_status = 'approved'`,
   *      `granted_by` and `access_granted_at`.
   *
   * Super admin only. Only academic_admin / finance_admin can be created
   * through this flow (super admins are bootstrapped by the backfill).
   *
   * @param input - name, email, phone, password, adminRole.
   */
  async createAdmin(input: CreateAdminInput): Promise<ApiResponse<CreateAdminResult>> {
    try {
      // ── Validation ────────────────────────────────────────────────────
      if (!input.name?.trim()) {
        return { success: false, error: 'Full name is required.' };
      }

      if (!input.phone?.trim()) {
        return { success: false, error: 'Phone number is required.' };
      }
      const phoneRegex = /^\+[1-9]\d{6,14}$/;
      if (!phoneRegex.test(input.phone.trim())) {
        return {
          success: false,
          error: 'Please enter a valid phone number with country code (e.g. +919876543210).',
        };
      }

      if (!input.password || input.password.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters.' };
      }

      if (input.email?.trim() && !/^\S+@\S+\.\S+$/.test(input.email.trim())) {
        return { success: false, error: 'Please enter a valid email address.' };
      }

      if (input.adminRole !== 'academic_admin' && input.adminRole !== 'finance_admin') {
        return {
          success: false,
          error: 'Only academic_admin and finance_admin roles can be created here.',
        };
      }

      // ── Authorization pre-check (edge function re-verifies) ───────────
      if (!(await this.isSuperAdmin())) {
        return {
          success: false,
          error: 'Only a super admin can create admin accounts.',
        };
      }

      // ── Invoke the secure Admin Identity edge function ────────────────
      // The service role key lives only inside the edge function. The
      // browser sends the request data; the function resolves the caller's
      // institute server-side and creates the account via the Admin API.
      const { data, error } = await supabase.functions.invoke(
        'admin-identity-create',
        {
          body: {
            name: input.name.trim(),
            email: input.email?.trim() || undefined,
            phone: input.phone.trim(),
            password: input.password,
            adminRole: input.adminRole,
          },
        },
      );

      if (error) {
        return { success: false, error: await extractFunctionsErrorMessage(error) };
      }

      const result = data as {
        success: boolean;
        adminId?: string;
        profileId?: string;
        adminRole?: AdminRole;
        accessStatus?: AdminAccessStatus;
        error?: string;
      } | null;

      if (!result?.success || !result.adminId || !result.profileId) {
        return {
          success: false,
          error: result?.error ?? 'Failed to create admin account. Please try again.',
        };
      }

      // ── Audit: admin account created (strict — security sensitive) ──
      await auditService.logCreate(
        {
          resourceType: 'admin_roles',
          resourceId: result.profileId,
          metadata: {
            name: input.name.trim(),
            phone: input.phone.trim(),
            email: input.email?.trim() ?? null,
            adminRole: result.adminRole ?? input.adminRole,
            accessStatus: result.accessStatus ?? 'approved',
            grantedBy: undefined,
          },
        },
        { strict: true },
      );

      return {
        success: true,
        data: {
          adminId: result.adminId,
          profileId: result.profileId,
          adminRole: result.adminRole ?? input.adminRole,
          accessStatus: result.accessStatus ?? 'approved',
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  9. Permission helper (service-layer)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * True when the current user has the given admin permission.
   *
   * Wraps `permission.checkPermission` with a live role fetch so service
   * code can enforce capabilities without manual role checks.
   *
   * @param permissionName - One of the AdminPermission names.
   */
  async hasPermission(permissionName: AdminPermission): Promise<boolean> {
    const result = await this.getCurrentAdminRoles();
    if (!result.success) return false;

    return checkPermission(result.data ?? [], permissionName);
  },
};
