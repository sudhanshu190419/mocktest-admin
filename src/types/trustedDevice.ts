/**
 * Trusted Device Types
 *
 * Client-side types for the Trusted Device system (Phase 7C/7D).
 *
 * Mirrors the statuses returned by the `device-challenge` edge function:
 *   - 'bypass'   → super admin / teacher / student (device system N/A)
 *   - 'approved' → trusted device → dashboard
 *   - 'pending'  → awaiting super admin approval → waiting screen
 *   - 'rejected' → rejected → rejected screen
 *   - 'revoked'  → revoked → revoked screen
 *   - 'expired'  → expired → expired screen
 *   - 'inactive' → deactivated → treated like expired (re-request)
 *
 * @module types/trustedDevice
 */

/** Device trust status as surfaced by the challenge edge function. */
export type DeviceTrustStatus =
  | 'bypass'
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'revoked'
  | 'expired'
  | 'inactive';

/**
 * Device challenge state held in AuthContext.
 *
 * `'checking'` is a client-only transient state used while the challenge is
 * in flight (before the edge function responds). Every other value mirrors
 * the edge function's `status` field.
 */
export type DeviceCheckState =
  | 'checking'
  | DeviceTrustStatus;

/**
 * Minimal device info shown on the waiting / rejected / revoked / expired
 * screens. Populated by AuthContext after a challenge so screens never need
 * to re-query.
 */
export interface DeviceInfo {
  /** trusted_devices.device_id. */
  deviceId: string;
  /** Human-readable device name from the challenge request. */
  deviceName: string | null;
  /** Current status. */
  status: DeviceTrustStatus;
  /** When the device request was created. */
  requestedAt: string | null;
  /** Rejection reason (only meaningful for rejected devices). */
  rejectionReason: string | null;
}

/** Map of blocking statuses → admin device status routes. */
export const DEVICE_STATUS_ROUTES: Record<
  Exclude<DeviceTrustStatus, 'bypass' | 'approved'>,
  string
> = {
  pending: '/admin/device-pending',
  rejected: '/admin/device-rejected',
  revoked: '/admin/device-revoked',
  expired: '/admin/device-expired',
  inactive: '/admin/device-expired',
};

/** True when a trust status should block the admin workspace. */
export function isBlockingDeviceStatus(
  status: DeviceCheckState | DeviceTrustStatus | undefined | null,
): boolean {
  if (!status) return false;
  return (
    status === 'pending' ||
    status === 'rejected' ||
    status === 'revoked' ||
    status === 'expired' ||
    status === 'inactive'
  );
}

/**
 * Resolve the admin route for a blocking device status.
 * Returns null for non-blocking statuses ('checking' / bypass / approved /
 * undefined).
 */
export function getDeviceStatusRoute(
  status: DeviceCheckState | DeviceTrustStatus | undefined | null,
): string | null {
  if (!isBlockingDeviceStatus(status)) return null;
  return DEVICE_STATUS_ROUTES[status as Exclude<DeviceTrustStatus, 'bypass' | 'approved'>];
}
