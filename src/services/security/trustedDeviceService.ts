/**
 * Trusted Device Service
 *
 * Frontend-safe wrapper around the Trusted Device edge functions (Phase 7C).
 *
 * The browser NEVER calls the edge functions directly. Every device
 * interaction goes through this service, which:
 *
 *   - mints a cryptographically secure random device token (plaintext only —
 *     stored in the HttpOnly cookie in a later phase; NEVER persisted),
 *   - invokes the corresponding edge function with the caller's JWT,
 *   - normalizes errors into friendly application messages.
 *
 * ## Edge functions invoked
 *
 *   device-challenge  → challengeDevice()
 *   device-approve    → approveDevice()      (super admin)
 *   device-reject     → rejectDevice()       (super admin)
 *   device-revoke     → revokeDevice()       (super admin)
 *   device-list       → getMyDevices() / getPendingDevices()
 *
 * ## Business rules (enforced server-side in the edge functions)
 *
 *   - Super Admin always bypasses the approval workflow (trusted).
 *   - Teacher / Student bypass the Trusted Device system entirely.
 *   - Academic / Finance Admin require an approved device.
 *   - One approved device per admin (approving a new one revokes the old).
 *   - The database stores only the SHA-256 hash of the device token.
 *
 * @module services/security/trustedDeviceService
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/config/supabase';
import { extractErrorMessage } from '@/utils/supabase';
import type { ApiResponse } from '@/types/academic';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Lifecycle state of a trusted device (mirrors trusted_device_status). */
export type TrustedDeviceStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'expired'
  | 'inactive';

/** Result status of a device challenge. */
export type DeviceChallengeStatus = 'bypass' | TrustedDeviceStatus;

/**
 * A trusted device as consumed by the application.
 *
 * `device_token_hash` is NEVER returned by the backend and therefore absent
 * here — the plaintext token lives only in the HttpOnly cookie.
 */
export interface TrustedDevice {
  deviceId: string;
  profileId: string;
  instituteId: string;
  deviceName: string;
  status: TrustedDeviceStatus;
  requestedAt: string | null;
  approvedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Super-admin accountability fields (omitted for device owners). */
  fingerprintHash?: string | null;
  userAgent?: string | null;
  lastIpAddress?: string | null;
}

/** Input to `challengeDevice` — describes the device making the request. */
export interface DeviceChallengeInput {
  /**
   * The plaintext device token previously issued for this browser (from the
   * `td_device` HttpOnly cookie, set in a later phase).
   *
   * CRITICAL: the same token MUST be presented on every challenge so the
   * edge function can match the stored SHA-256 hash. When omitted (first
   * login / no cookie), the service mints a fresh token and returns it in
   * the result for cookie storage.
   */
  deviceToken?: string;
  /** Stable browser/device fingerprint for anomaly reporting. */
  fingerprint?: string;
  /** Human-readable device name (e.g. "Chrome on Windows"). */
  deviceName?: string;
  /** User-Agent string. */
  userAgent?: string;
  /**
   * Phase 7F: when true, request a NEW approval for this device (used by the
   * revoked/expired screens' "request approval again" action). The edge
   * function skips the fingerprint auto-match — the old row (revoked/expired)
   * keeps its fingerprint_hash and would otherwise surface the old blocking
   * status — and instead creates (or reuses) a fresh pending request.
   */
  forceNewRequest?: boolean;
}

/** Result of a device challenge. */
export interface DeviceChallengeResult {
  /** True when the caller may proceed to the admin workspace. */
  trusted: boolean;
  /** 'bypass' for super admin / teacher / student; else the device status. */
  status: DeviceChallengeStatus;
  /** The trusted_devices row id (present once a request exists). */
  deviceId?: string;
  /**
   * Plaintext device token minted for a NEW device request.
   *
   * A later phase stores this in the HttpOnly `td_device` cookie so
   * subsequent challenges can present it. It is never persisted server-side
   * (only its SHA-256 hash is stored).
   */
  deviceToken?: string;
}

// ─── Token generation ───────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure 256-bit device token (URL-safe base64).
 *
 * The plaintext token is returned to the caller for cookie storage; the
 * edge functions store only its SHA-256 hash.
 */
function generateDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// ─── Edge Function helper ───────────────────────────────────────────────────

/**
 * Extract a user-friendly error message from a `supabase.functions.invoke`
 * failure (same pattern as adminRoleService).
 *
 * Device edge functions return JSON shaped as `{ success: false, error }`.
 * On non-2xx, supabase-js surfaces a `FunctionsHttpError` whose `context`
 * is the raw Response — we read the JSON body to recover the server message.
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

// ─── Service ────────────────────────────────────────────────────────────────

export const trustedDeviceService = {
  // ─────────────────────────────────────────────────────────────────────────
  //  1. Challenge a device (call after phone/password sign-in)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Validate whether the current admin's device is trusted.
   *
   * Behavior (server-side):
   *   - Super Admin → trusted, status 'bypass'
   *   - Teacher/Student → trusted, status 'bypass'
   *   - Academic/Finance Admin:
   *       approved → trusted + touches last_used_at / last_ip_address
   *       pending/rejected/revoked/expired/inactive → not trusted
   *       no device → a NEW pending request is created and the plaintext
   *                   deviceToken is returned for cookie storage.
   *
   * @param input - Device descriptors (all optional).
   */
  async challengeDevice(
    input: DeviceChallengeInput = {},
  ): Promise<ApiResponse<DeviceChallengeResult>> {
    try {
      // Reuse the previously issued token (from the cookie in a later phase)
      // so an approved device keeps matching its stored hash. Only mint a
      // fresh token when none is presented — it becomes the credential for
      // the new pending request and must be persisted for future challenges.
      const deviceToken = input.deviceToken?.trim() || generateDeviceToken();

      const { data, error } = await supabase.functions.invoke(
        'device-challenge',
        {
          body: {
            deviceToken,
            fingerprint: input.fingerprint?.trim() || undefined,
            deviceName: input.deviceName?.trim() || undefined,
            userAgent: input.userAgent?.trim() || undefined,
            forceNewRequest: input.forceNewRequest ?? false,
          },
        },
      );

      if (error) {
        return { success: false, error: await extractFunctionsErrorMessage(error) };
      }

      const result = data as {
        trusted?: boolean;
        status?: DeviceChallengeStatus;
        deviceId?: string;
      } | null;

      if (!result || typeof result.trusted !== 'boolean' || !result.status) {
        return {
          success: false,
          error: 'Unexpected response from the device service. Please try again.',
        };
      }

      return {
        success: true,
        data: {
          trusted: result.trusted,
          status: result.status,
          deviceId: result.deviceId,
          deviceToken,
        },
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  2. Approve a pending device (super admin)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Approve a pending trusted device request.
   *
   * Super admin only (enforced in the edge function). Automatically revokes
   * the previously approved device for that profile (one-approved-device rule).
   *
   * @param deviceId - The trusted_devices.device_id.
   */
  async approveDevice(deviceId: string): Promise<ApiResponse<{ deviceId: string }>> {
    try {
      if (!deviceId?.trim()) {
        return { success: false, error: 'Device id is required.' };
      }

      const { data, error } = await supabase.functions.invoke('device-approve', {
        body: { deviceId: deviceId.trim() },
      });

      if (error) {
        return { success: false, error: await extractFunctionsErrorMessage(error) };
      }

      const result = data as { success?: boolean; deviceId?: string } | null;
      if (!result?.success || !result.deviceId) {
        return {
          success: false,
          error: result?.success === false
            ? (data as { error?: string } | null)?.error ?? 'Could not approve the device.'
            : 'Unexpected response from the device service.',
        };
      }

      return { success: true, data: { deviceId: result.deviceId } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  3. Reject a pending device (super admin)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Reject a pending trusted device request.
   *
   * Super admin only (enforced in the edge function). Stores the rejection
   * reason and notifies the device owner.
   *
   * @param deviceId - The trusted_devices.device_id.
   * @param reason   - Optional rejection reason shown to the owner.
   */
  async rejectDevice(
    deviceId: string,
    reason?: string,
  ): Promise<ApiResponse<{ deviceId: string }>> {
    try {
      if (!deviceId?.trim()) {
        return { success: false, error: 'Device id is required.' };
      }

      const { data, error } = await supabase.functions.invoke('device-reject', {
        body: { deviceId: deviceId.trim(), reason: reason?.trim() || undefined },
      });

      if (error) {
        return { success: false, error: await extractFunctionsErrorMessage(error) };
      }

      const result = data as { success?: boolean; deviceId?: string } | null;
      if (!result?.success || !result.deviceId) {
        return {
          success: false,
          error: result?.success === false
            ? (data as { error?: string } | null)?.error ?? 'Could not reject the device.'
            : 'Unexpected response from the device service.',
        };
      }

      return { success: true, data: { deviceId: result.deviceId } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  4. Revoke an approved device (super admin)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Revoke an approved trusted device.
   *
   * Super admin only (enforced in the edge function). Clears approved_at
   * (per ck_trusted_devices_approved) and notifies the device owner.
   *
   * @param deviceId - The trusted_devices.device_id.
   */
  async revokeDevice(deviceId: string): Promise<ApiResponse<{ deviceId: string }>> {
    try {
      if (!deviceId?.trim()) {
        return { success: false, error: 'Device id is required.' };
      }

      const { data, error } = await supabase.functions.invoke('device-revoke', {
        body: { deviceId: deviceId.trim() },
      });

      if (error) {
        return { success: false, error: await extractFunctionsErrorMessage(error) };
      }

      const result = data as { success?: boolean; deviceId?: string } | null;
      if (!result?.success || !result.deviceId) {
        return {
          success: false,
          error: result?.success === false
            ? (data as { error?: string } | null)?.error ?? 'Could not revoke the device.'
            : 'Unexpected response from the device service.',
        };
      }

      return { success: true, data: { deviceId: result.deviceId } };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  //  5. List devices
  // ─────────────────────────────────────────────────────────────────────────

  /** Map a backend device row to the camelCase TrustedDevice shape. */
  mapDevice(raw: Record<string, unknown>): TrustedDevice {
    return {
      deviceId: String(raw.device_id),
      profileId: String(raw.profile_id),
      instituteId: String(raw.institute_id),
      deviceName: String(raw.device_name ?? 'Unknown device'),
      status: raw.status as TrustedDeviceStatus,
      requestedAt: (raw.requested_at as string | null) ?? null,
      approvedAt: (raw.approved_at as string | null) ?? null,
      lastUsedAt: (raw.last_used_at as string | null) ?? null,
      expiresAt: (raw.expires_at as string | null) ?? null,
      rejectionReason: (raw.rejection_reason as string | null) ?? null,
      createdAt: (raw.created_at as string | null) ?? null,
      updatedAt: (raw.updated_at as string | null) ?? null,
      fingerprintHash: (raw.fingerprint_hash as string | null | undefined) ?? null,
      userAgent: (raw.user_agent as string | null | undefined) ?? null,
      lastIpAddress: (raw.last_ip_address as string | null | undefined) ?? null,
    };
  },

  /**
   * List devices. The edge function scopes the result by the caller:
   *   - scope 'own' → the caller's devices (any admin).
   *   - scope 'pending' / 'approved' / absent → super admin full queue.
   *
   * NOTE: passing query params by appending them to the function name
   * (e.g. `device-list?scope=own`) is intentional — supabase-js v2 parses
   * the resulting URL and forwards the query string to the edge function.
   *
   * @param scope - 'own' | 'pending' | 'approved' | undefined (super admin).
   */
  async listDevices(
    scope?: 'own' | 'pending' | 'approved',
  ): Promise<ApiResponse<TrustedDevice[]>> {
    try {
      const searchParams = new URLSearchParams();
      if (scope) searchParams.set('scope', scope);

      const query = searchParams.toString();
      const { data, error } = await supabase.functions.invoke(
        `device-list${query ? `?${query}` : ''}`,
        { method: 'GET' },
      );

      if (error) {
        return { success: false, error: await extractFunctionsErrorMessage(error) };
      }

      const result = data as { success?: boolean; devices?: unknown[] } | null;
      if (!result?.success || !Array.isArray(result.devices)) {
        return {
          success: false,
          error: result?.success === false
            ? (data as { error?: string } | null)?.error ?? 'Could not list devices.'
            : 'Unexpected response from the device service.',
        };
      }

      return {
        success: true,
        data: result.devices.map((d) => this.mapDevice(d as Record<string, unknown>)),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  /** Convenience: the caller's own devices (any admin). */
  async getMyDevices(): Promise<ApiResponse<TrustedDevice[]>> {
    return this.listDevices('own');
  },

  /** Convenience: pending approval queue (super admin). */
  async getPendingDevices(): Promise<ApiResponse<TrustedDevice[]>> {
    return this.listDevices('pending');
  },

  /** Convenience: approved devices (super admin). */
  async getApprovedDevices(): Promise<ApiResponse<TrustedDevice[]>> {
    return this.listDevices('approved');
  },
};
