// ============================================================================
// LiveKit Webhook Verification via WebhookReceiver
//
// LiveKit Cloud sends webhooks with an Authorization header containing a
// signed JWT. This module uses the official livekit-server-sdk WebhookReceiver
// to verify the JWT signature using LIVEKIT_API_KEY and LIVEKIT_API_SECRET.
//
// Environment variables required at call site:
//   LIVEKIT_API_KEY    — LiveKit project API key
//   LIVEKIT_API_SECRET — LiveKit project API secret
//
// @module functions/livekit-webhook/verify
// ============================================================================

import { WebhookReceiver } from 'npm:livekit-server-sdk@2.8.1';

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify that a webhook request was genuinely sent by LiveKit Cloud.
 *
 * Uses the official `WebhookReceiver` from `livekit-server-sdk` to validate
 * the signed JWT in the `Authorization` header against the LiveKit API
 * credentials.
 *
 * @param body      - Raw request body as a string (must be unparsed)
 * @param authHeader - Full value of the Authorization header (e.g. "Bearer <jwt>")
 * @param apiKey    - LIVEKIT_API_KEY
 * @param apiSecret - LIVEKIT_API_SECRET
 * @returns The parsed and verified WebhookEvent object
 * @throws If signature verification fails (invalid JWT, expired, malformed)
 */
export async function verifyWebhook(
  body: string,
  authHeader: string,
  apiKey: string,
  apiSecret: string,
): Promise<unknown> {
  const receiver = new WebhookReceiver(apiKey, apiSecret);
  const event = await receiver.receive(body, authHeader);
  return event;
}
