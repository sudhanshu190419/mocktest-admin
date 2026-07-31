/**
 * Admin Management Hooks
 *
 * React Query hooks for the Admin Management module (super admin only).
 *
 * Follows the same pattern as hooks/admin/useTeacherLifecycle.ts.
 *
 * ## Exports
 *
 * | Hook                       | Description                              |
 * |----------------------------|------------------------------------------|
 * | `useAdminUsers`            | List admin users for an institute        |
 * | `useCreateAdmin`           | Create a new admin (auth + profile + role) |
 * | `useSuspendAdminRole`      | Suspend an admin role                    |
 * | `useReactivateAdminRole`   | Reactivate / approve an admin role       |
 * | `useRevokeAdminRole`       | Revoke an admin role                     |
 *
 * @module hooks/admin/useAdminManagement
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { adminRoleService } from '@/services/admin/adminRoleService';
import type { CreateAdminInput } from '@/types/adminRoles';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List admin users (profiles with role = 'admin') with their roles.
 *
 * Super admin only (enforced by the service + RLS).
 *
 * @param instituteId - Institute scope for the listing.
 * @param search      - Optional search across name, email and phone.
 *
 * Cache key: `['admin', 'adminManagement', 'list', instituteId, search]`
 * Stale time: 1 minute (admin roles change during management sessions)
 */
export function useAdminUsers(instituteId: string | null, search?: string) {
  return useQuery({
    queryKey: adminKeys.adminManagement.list(instituteId, search),
    queryFn: async () => {
      if (!instituteId) return [];
      const result = await adminRoleService.listAdminUsers(instituteId, search);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch admin users.');
      }
      return result.data!;
    },
    staleTime: 1 * 60 * 1000,
    enabled: !!instituteId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options for invalidating admin management caches.
 */
function useInvalidateAdminManagement() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.adminManagement.all() }),
    ]);
  };
}

/**
 * Create a new admin account (auth user + profile + approved role).
 */
export function useCreateAdmin() {
  const invalidate = useInvalidateAdminManagement();

  return useMutation({
    mutationFn: (input: CreateAdminInput) => adminRoleService.createAdmin(input),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Suspend an admin role (approved → suspended).
 */
export function useSuspendAdminRole() {
  const invalidate = useInvalidateAdminManagement();

  return useMutation({
    mutationFn: (adminRoleId: string) => adminRoleService.suspendAdminRole(adminRoleId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Reactivate / approve an admin role (suspended/pending → approved).
 */
export function useReactivateAdminRole() {
  const invalidate = useInvalidateAdminManagement();

  return useMutation({
    mutationFn: (adminRoleId: string) => adminRoleService.reactivateAdminRole(adminRoleId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Revoke an admin role (soft removal — sets access_status = 'revoked').
 */
export function useRevokeAdminRole() {
  const invalidate = useInvalidateAdminManagement();

  return useMutation({
    mutationFn: (adminRoleId: string) => adminRoleService.revokeAdminRole(adminRoleId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
