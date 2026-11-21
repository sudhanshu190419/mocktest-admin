/**
 * Make Me Topper — Email Webhook Core Logic
 *
 * Implements:
 * 1. Resend / Svix standard webhook cryptographic signature verification (HMAC-SHA256).
 * 2. Replay attack protection with timestamp freshness checks.
 * 3. Constant-time signature comparison to prevent timing side-channels.
 * 4. Delivery status state machine transitions:
 *    - email.delivered -> delivery_status: delivered
 *    - email.bounced   -> delivery_status: bounced (+ hard_bounce suppression)
 *    - email.complained -> delivery_status: complained (+ complaint suppression)
 *    - email.opened / clicked -> audit logging
 */

import { ResendWebhookPayload } from '../_shared/email/types.ts';

export interface WebhookDatabase {
  isEventProcessed(svixEventId: string): Promise<boolean>;

  recordDeliveryStatus(
    providerMessageId: string,
    status: 'delivered' | 'bounced' | 'complained',
    eventType: string,
    rawPayload: Record<string, unknown>,
    svixEventId?: string | null
  ): Promise<boolean>;

  addSuppression(
    email: string,
    reason: 'hard_bounce' | 'complaint' | 'manual',
    source: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean>;

  recordAuditLog(
    providerMessageId: string,
    eventType: string,
    rawPayload: Record<string, unknown>,
    svixEventId?: string | null
  ): Promise<boolean>;
}

export interface VerifyWebhookOptions {
  secret: string;
  payload: string;
  svixId?: string | null;
  svixTimestamp?: string | null;
  svixSignature?: string | null;
  toleranceSeconds?: number;
}

/**
 * Constant-time string equality check to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Decodes base64 string to Uint8Array safely across Node & Deno.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  // Use Buffer if available (Node.js & modern Deno)
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  let b64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) {
    b64 += '=';
  }
  const binaryString = atob(b64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes Uint8Array or ArrayBuffer to base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return Buffer.from(bytes).toString('base64');
  }
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Verifies Svix / Resend webhook signature using Web Crypto HMAC-SHA256.
 */
export async function verifySvixWebhookSignature(
  options: VerifyWebhookOptions
): Promise<{ valid: boolean; reason?: string }> {
  const {
    secret,
    payload,
    svixId,
    svixTimestamp,
    svixSignature,
    toleranceSeconds = 300,
  } = options;

  if (!svixId) return { valid: false, reason: 'MISSING_SVIX_ID' };
  if (!svixTimestamp) return { valid: false, reason: 'MISSING_SVIX_TIMESTAMP' };
  if (!svixSignature) return { valid: false, reason: 'MISSING_SVIX_SIGNATURE' };
  if (!secret) return { valid: false, reason: 'MISSING_WEBHOOK_SECRET' };

  // Timestamp freshness check
  const timestampNum = parseInt(svixTimestamp, 10);
  if (isNaN(timestampNum)) return { valid: false, reason: 'INVALID_TIMESTAMP_FORMAT' };

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampNum) > toleranceSeconds) {
    return { valid: false, reason: 'TIMESTAMP_TOLERANCE_EXCEEDED' };
  }

  // Svix secret key format: "whsec_<base64>" or raw base64
  let rawSecretBase64 = secret;
  if (secret.startsWith('whsec_')) {
    rawSecretBase64 = secret.slice(6);
  }

  let secretBytes: Uint8Array;
  try {
    secretBytes = base64ToUint8Array(rawSecretBase64);
  } catch {
    return { valid: false, reason: 'INVALID_BASE64_SECRET' };
  }

  // Signed payload string: `${svix_id}.${svix_timestamp}.${raw_payload}`
  const signedData = `${svixId}.${svixTimestamp}.${payload}`;
  const signedBytes = new TextEncoder().encode(signedData);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, signedBytes);
  const computedSignatureBase64 = arrayBufferToBase64(signatureBuffer);

  // svix-signature header contains space-separated versions: "v1,signature1 v1,signature2"
  const passedSignatures = svixSignature.split(' ');
  let signatureMatched = false;

  for (const sigItem of passedSignatures) {
    const [version, signatureValue] = sigItem.split(',');
    if (version === 'v1' && signatureValue) {
      if (timingSafeEqual(signatureValue, computedSignatureBase64)) {
        signatureMatched = true;
        break;
      }
    }
  }

  if (!signatureMatched) {
    return { valid: false, reason: 'SIGNATURE_MISMATCH' };
  }

  return { valid: true };
}

export interface ProcessWebhookMetadata {
  svixId?: string | null;
  svixTimestamp?: string | null;
}

/**
 * Handles verified webhook event with idempotent deduplication via svix_event_id.
 */
export async function processWebhookEvent(
  db: WebhookDatabase,
  event: ResendWebhookPayload,
  metadata?: ProcessWebhookMetadata
): Promise<{ success: boolean; action: string; details?: unknown }> {
  const svixEventId = metadata?.svixId?.trim();

  // 1. Deduplication guard: Skip processing if event ID was already recorded
  if (svixEventId) {
    const alreadyProcessed = await db.isEventProcessed(svixEventId);
    if (alreadyProcessed) {
      return {
        success: true,
        action: 'IGNORED_DUPLICATE_EVENT',
        details: { svixEventId },
      };
    }
  }

  const eventType = event.type?.toLowerCase();
  const providerMessageId = event.data?.id;

  if (!providerMessageId) {
    return { success: true, action: 'IGNORED_NO_MESSAGE_ID' };
  }

  switch (eventType) {
    case 'email.delivered': {
      await db.recordDeliveryStatus(
        providerMessageId,
        'delivered',
        eventType,
        event as unknown as Record<string, unknown>,
        svixEventId
      );
      return { success: true, action: 'DELIVERY_RECORDED' };
    }

    case 'email.bounced': {
      const isPermanent =
        !event.data?.bounce?.type ||
        event.data.bounce.type === 'permanent' ||
        event.data.bounce.type === 'undetermined';

      if (isPermanent && Array.isArray(event.data?.to)) {
        for (const recipient of event.data.to) {
          if (recipient) {
            await db.addSuppression(
              recipient.toLowerCase().trim(),
              'hard_bounce',
              'webhook',
              { providerMessageId, svixEventId, bounce: event.data.bounce }
            );
          }
        }
      }

      await db.recordDeliveryStatus(
        providerMessageId,
        'bounced',
        eventType,
        event as unknown as Record<string, unknown>,
        svixEventId
      );
      return {
        success: true,
        action: isPermanent ? 'HARD_BOUNCE_SUPPRESSED' : 'TRANSIENT_BOUNCE_RECORDED',
      };
    }

    case 'email.complained': {
      if (Array.isArray(event.data?.to)) {
        for (const recipient of event.data.to) {
          if (recipient) {
            await db.addSuppression(
              recipient.toLowerCase().trim(),
              'complaint',
              'webhook',
              { providerMessageId, svixEventId }
            );
          }
        }
      }

      await db.recordDeliveryStatus(
        providerMessageId,
        'complained',
        eventType,
        event as unknown as Record<string, unknown>,
        svixEventId
      );
      return { success: true, action: 'COMPLAINT_SUPPRESSED' };
    }

    case 'email.opened':
    case 'email.clicked': {
      await db.recordAuditLog(
        providerMessageId,
        eventType,
        event as unknown as Record<string, unknown>,
        svixEventId
      );
      return { success: true, action: 'ENGAGEMENT_LOGGED' };
    }

    default: {
      if (svixEventId) {
        await db.recordAuditLog(
          providerMessageId,
          eventType || 'unknown',
          event as unknown as Record<string, unknown>,
          svixEventId
        );
      }
      return { success: true, action: `IGNORED_EVENT_${eventType}` };
    }
  }
}

/**
 * Creates WebhookDatabase adapter using Supabase client.
 */
// deno-lint-ignore no-explicit-any
export function createSupabaseWebhookDb(supabaseClient: any): WebhookDatabase {
  return {
    async isEventProcessed(svixEventId: string): Promise<boolean> {
      if (!svixEventId) return false;
      const { data, error } = await supabaseClient
        .from('email_delivery_logs')
        .select('log_id')
        .eq('svix_event_id', svixEventId)
        .limit(1);

      if (error) {
        console.warn(`[email-webhook] Error checking svix_event_id:`, error);
        return false;
      }
      return !!(data && data.length > 0);
    },

    async recordDeliveryStatus(
      providerMessageId: string,
      status: 'delivered' | 'bounced' | 'complained',
      eventType: string,
      rawPayload: Record<string, unknown>,
      svixEventId?: string | null
    ): Promise<boolean> {
      // 1. Update queue table
      const { data: queueRows } = await supabaseClient
        .from('email_queue')
        .update({
          delivery_status: status,
          updated_at: new Date().toISOString(),
        })
        .eq('provider_message_id', providerMessageId)
        .select('queue_id');

      const queueId = queueRows?.[0]?.queue_id || null;

      // 2. Insert delivery log with unique svix_event_id
      await supabaseClient.from('email_delivery_logs').insert(
        {
          queue_id: queueId,
          provider: 'resend',
          event_type: eventType,
          provider_message_id: providerMessageId,
          svix_event_id: svixEventId || null,
          payload: rawPayload,
        },
        { onConflict: 'svix_event_id' }
      );

      return true;
    },

    async addSuppression(
      email: string,
      reason: 'hard_bounce' | 'complaint' | 'manual',
      source: string,
      metadata?: Record<string, unknown>
    ): Promise<boolean> {
      const { error } = await supabaseClient.from('email_suppressions').upsert(
        {
          email: email.toLowerCase().trim(),
          reason,
          source,
          metadata: metadata || {},
          suppressed_at: new Date().toISOString(),
        },
        { onConflict: 'email' }
      );

      return !error;
    },

    async recordAuditLog(
      providerMessageId: string,
      eventType: string,
      rawPayload: Record<string, unknown>,
      svixEventId?: string | null
    ): Promise<boolean> {
      const { data: queueRows } = await supabaseClient
        .from('email_queue')
        .select('queue_id')
        .eq('provider_message_id', providerMessageId)
        .limit(1);

      const queueId = queueRows?.[0]?.queue_id || null;

      await supabaseClient.from('email_delivery_logs').insert(
        {
          queue_id: queueId,
          provider: 'resend',
          event_type: eventType,
          provider_message_id: providerMessageId,
          svix_event_id: svixEventId || null,
          payload: rawPayload,
        },
        { onConflict: 'svix_event_id' }
      );

      return true;
    },
  };
}
