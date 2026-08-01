// ============================================================================
// Shared Helper: Trusted Device Backend
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Reusable building blocks for the Trusted Device workflow (Phase 7C). All
// five edge functions (device-challenge, device-approve, device-reject,
// device-revoke, device-list) import these helpers instead of re-implementing
// token hashing, notification fan-out, and audit writes.
//
// ## Security principles (inherited from _shared/adminIdentity.ts)
//
//   1. The device token is NEVER persisted — only its SHA-256 hash is stored
//      in `trusted_devices.device_token_hash`. A database leak cannot be
//      replayed as a valid device token.
//   2. Audit writes go through a client bound to the CALLER's JWT
//      (createCallerClient) — `write_audit_log()` derives the actor from
//      `auth.uid()`, so the service-role client would record profile_id =
//      NULL and lose accountability. Never audit with the service role.
//   3. Notifications reuse the existing `notifications` +
//      `notification_recipients` tables (service role, which bypasses RLS —
//      matching the project's dispatch-notification convention).
//   4. Raw Postgres / GoTrue errors are NEVER surfaced to clients.
//
// @module _shared/trustedDevice
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createCallerClient, structuredLog } from './adminIdentity.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Token Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * SHA-256 hex digest of a device token.
 *
 * The edge functions hash the client-supplied token on every challenge and
 * compare against `trusted_devices.device_token_hash`. The plaintext token
 * only ever lives in the HttpOnly cookie (set in a later phase) and the
 * browser session — never in the database.
 *
 * @param token - The plaintext device token (from the td_device cookie).
 */
export async function hashDeviceToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a cryptographically secure 256-bit device token (URL-safe base64).
 *
 * Used by the backend service to mint a token for a brand-new device. The
 * service returns the plaintext to the caller (which will store it in an
 * HttpOnly cookie in a later phase); the database stores only its hash.
 */
export function generateDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// Notification Helpers (reuses existing notifications infrastructure)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a notification event + recipient rows (service role, bypasses RLS).
 *
 * Mirrors the shape produced by the frontend `createBulkNotification` so no
 * new notification infrastructure is introduced.
 *
 * @param serviceClient - Service-role client.
 * @param params        - instituteId, recipientIds, title, body, eventType,
 *                        referenceId (trusted_devices.device_id).
 */
export async function createDeviceNotification(
  serviceClient: ReturnType<typeof createClient>,
  params: {
    instituteId: string;
    recipientIds: string[];
    title: string;
    body: string;
    eventType: string;
    referenceId: string;
  },
): Promise<void> {
  const { instituteId, recipientIds, title, body, eventType, referenceId } =
    params;

  if (recipientIds.length === 0) return;

  const nowIso = new Date().toISOString();

  // 1. Create the notification event row.
  const { data: notifData, error: notifError } = await serviceClient
    .from('notifications')
    .insert({
      institute_id: instituteId,
      template_id: null,
      title,
      body,
      channel: 'in_app',
      event_type: eventType,
      triggered_by: null,
      reference_type: 'trusted_devices',
      reference_id: referenceId,
      total_recipients: recipientIds.length,
      dispatched_at: nowIso,
    })
    .select('notification_id')
    .single();

  if (notifError || !notifData) {
    // Non-fatal: notification failure must never break the device workflow.
    structuredLog('DEVICE_NOTIFICATION_CREATE_FAILED', {
      eventType,
      error: notifError?.message ?? 'no notification_id returned',
    });
    return;
  }

  // 2. Fan out recipient rows.
  const { error: recipientError } = await serviceClient
    .from('notification_recipients')
    .insert(
      recipientIds.map((profileId) => ({
        notification_id: notifData.notification_id,
        profile_id: profileId,
        institute_id: instituteId,
        is_read: false,
        received_at: nowIso,
      })),
    );

  if (recipientError) {
    structuredLog('DEVICE_NOTIFICATION_RECIPIENTS_FAILED', {
      eventType,
      error: recipientError.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Audit Helpers (caller-JWT client — critical for actor derivation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Write an audit event using a client bound to the CALLER's JWT.
 *
 * `write_audit_log()` derives the actor from `auth.uid()`. If invoked with
 * the service-role client, auth.uid() is NULL and the event would record
 * profile_id = NULL (system actor) — losing accountability. All Trusted
 * Device edge functions therefore audit through the caller's token.
 *
 * Non-fatal by design: an audit failure must never break the device workflow
 * (matches auditService's default strict:false semantics).
 *
 * @param authHeader - The raw Authorization header ("Bearer <jwt>").
 * @param payload    - Snake_case RPC args for write_audit_log.
 */
export async function writeDeviceAudit(
  authHeader: string,
  payload: {
    p_action: string;
    p_resource_type: string;
    p_resource_id?: string | null;
    p_old_value?: Record<string, unknown> | null;
    p_new_value?: Record<string, unknown> | null;
    p_metadata?: Record<string, unknown> | null;
    p_ip_address?: string | null;
    p_user_agent?: string | null;
    p_reason?: string | null;
  },
): Promise<void> {
  try {
    const callerClient = createCallerClient(authHeader);
    const { error } = await callerClient.rpc('write_audit_log', payload);
    if (error) {
      structuredLog('DEVICE_AUDIT_FAILED', {
        action: payload.p_action,
        error: error.message,
      });
    }
  } catch (err) {
    structuredLog('DEVICE_AUDIT_UNEXPECTED', {
      action: payload.p_action,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}
