/**
 * Trusted Device Management Hooks
 *
 * React Query hooks for the Trusted Device module (super admin only).
 *
 * Follows the same pattern as hooks/admin/useAdminManagement.ts.
 *
 * ## Exports
 *
 * | Hook                     | Description                                  |
 * |--------------------------|----------------------------------------------|
 * | `usePendingDevices`      | Pending device approval queue (super admin)  |
 * | `useApprovedDevices`     | Approved trusted devices (super admin)       |
 * | `useApproveDevice`       | Approve a pending device request             |
 * | `useRejectDevice`        | Reject a pending device request (with reason)|
 * | `useRevokeDevice`        | Revoke an approved device                    |
 *
 * @module hooks/admin/useTrustedDevices
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminKeys } from './queryKeys';
import { trustedDeviceService } from '@/services/security/trustedDeviceService';

// ═══════════════════════════════════════════════════════════════════════════
//  Queries
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pending device approval queue.
 *
 * Super admin only (enforced by the edge function + service).
 *
 * Cache key: `['admin', 'trustedDevices', 'pending']`
 * Stale time: 30s (approvals arrive asynchronously)
 */
export function usePendingDevices() {
  return useQuery({
    queryKey: adminKeys.trustedDevices.pending(),
    queryFn: async () => {
      const result = await trustedDeviceService.getPendingDevices();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch pending devices.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * Approved trusted devices.
 *
 * Super admin only (enforced by the edge function + service).
 *
 * Cache key: `['admin', 'trustedDevices', 'approved']`
 * Stale time: 30s
 */
export function useApprovedDevices() {
  return useQuery({
    queryKey: adminKeys.trustedDevices.approved(),
    queryFn: async () => {
      const result = await trustedDeviceService.getApprovedDevices();
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch approved devices.');
      }
      return result.data!;
    },
    staleTime: 30 * 1000,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mutations
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shared mutation options — invalidate both device lists after any action.
 */
function useInvalidateTrustedDevices() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.trustedDevices.all() }),
    ]);
  };
}

/**
 * Approve a pending device request.
 * Server-side this auto-revokes the previously approved device for the owner.
 */
export function useApproveDevice() {
  const invalidate = useInvalidateTrustedDevices();

  return useMutation({
    mutationFn: (deviceId: string) => trustedDeviceService.approveDevice(deviceId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Reject a pending device request with an optional reason.
 */
export function useRejectDevice() {
  const invalidate = useInvalidateTrustedDevices();

  return useMutation({
    mutationFn: ({ deviceId, reason }: { deviceId: string; reason?: string }) =>
      trustedDeviceService.rejectDevice(deviceId, reason),
    onSuccess: async () => {
      await invalidate();
    },
  });
}

/**
 * Revoke an approved device.
 */
export function useRevokeDevice() {
  const invalidate = useInvalidateTrustedDevices();

  return useMutation({
    mutationFn: (deviceId: string) => trustedDeviceService.revokeDevice(deviceId),
    onSuccess: async () => {
      await invalidate();
    },
  });
}
