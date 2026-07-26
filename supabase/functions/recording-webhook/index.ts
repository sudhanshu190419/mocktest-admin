// ============================================================================
// Edge Function: recording-webhook
//
// Receives webhook events from LiveKit Cloud related to recording (egress)
// lifecycle. This function handles the following events:
//
//   - egress.completed  → Updates recordings row to 'completed'
//   - egress.failed     → Updates recordings row to 'failed'
//
// This function does NOT handle participant/room events (those are
// handled by the `livekit-webhook` Edge Function for attendance tracking).
//
// ── Webhook Verification ──────────────────────────────────────────────────
// Uses the same WebhookReceiver pattern as `livekit-webhook` to verify
// the signed JWT in the Authorization header using LIVEKIT_API_KEY and
// LIVEKIT_API_SECRET.
//
// ── Response ───────────────────────────────────────────────────────────────
// { "success": true, "processed": 1 }
//
// ── Environment Variables ──────────────────────────────────────────────────
// SUPABASE_URL              — Supabase project URL
// SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)
// LIVEKIT_API_KEY           — LiveKit project API key (for webhook verification)
// LIVEKIT_API_SECRET        — LiveKit project API secret (for webhook verification)
//
// @module edge-functions/recording-webhook
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { WebhookReceiver } from 'npm:livekit-server-sdk@2.8.1';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LiveKit Egress webhook event payload shape.
 *
 * @see https://docs.livekit.io/egress/webhooks/
 */
interface LiveKitEgressWebhookPayload {
  /** The event type (e.g. "egress.completed", "egress.failed"). */
  event: string;
  /** The egress object with status and metadata. */
  egress: {
    /** LiveKit Egress ID. */
    egress_id: string;
    /** Current status of the egress. */
    status: 'EGRESS_STARTING' | 'EGRESS_ACTIVE' | 'EGRESS_ENDING' | 'EGRESS_COMPLETE' | 'EGRESS_FAILED' | 'EGRESS_ABORTED';
    /** Error string if the egress failed. */
    error?: string;
    /** Duration of the egress in seconds (only when complete). */
    duration?: number;
  };
  /** Room info from the egress. */
  room?: {
    /** Room name that was recorded. */
    name: string;
    sid: string;
  };
  /** Unique event ID for idempotency. */
  id: string;
  /** Timestamp of the event. */
  created_at: number;
}

interface WebhookSuccessResponse {
  success: true;
  processed: number;
  errors?: string[];
}

interface WebhookErrorResponse {
  success: false;
  processed: 0;
  errors: string[];
}

type FunctionResponse = WebhookSuccessResponse | WebhookErrorResponse;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ═══════════════════════════════════════════════════════════════════════════
// Structured Logging
// ═══════════════════════════════════════════════════════════════════════════

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'recording-webhook',
      event,
      ...data,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function jsonResponse(body: FunctionResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 400): Response {
  structuredLog('WEBHOOK_ERROR', { error, statusCode: status });
  return jsonResponse({ success: false, processed: 0, errors: [error] }, status);
}

/**
 * Map LiveKit Egress status to our RecordingStatus.
 */
function mapEgressStatus(
  livekitStatus: string,
): 'completed' | 'failed' | null {
  switch (livekitStatus) {
    case 'EGRESS_COMPLETE':
    case 'EGRESS_ENDING':
      return 'completed';
    case 'EGRESS_FAILED':
    case 'EGRESS_ABORTED':
      return 'failed';
    default:
      structuredLog('UNRECOGNIZED_EGRESS_STATUS', {
        status: livekitStatus,
        hint: 'Received an unrecognized LiveKit egress status. This may be a new status added by LiveKit. Recording will not be updated.',
      });
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Handler
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle an egress.completed or egress.failed webhook event.
 *
 * Updates the corresponding recordings row in the database with the
 * final status, duration, file size, and storage path.
 */
async function handleEgressEvent(
  supabase: ReturnType<typeof createClient>,
  payload: LiveKitEgressWebhookPayload,
): Promise<string | null> {
  const egressId = payload.egress?.egress_id;
  const livekitStatus = payload.egress?.status;
  const roomName = payload.room?.name;

  if (!egressId || !livekitStatus) {
    return 'Missing egress_id or status in webhook payload';
  }

  structuredLog('EGRESS_EVENT_RECEIVED', {
    egressId: egressId.slice(0, 20) + '...',
    status: livekitStatus,
    roomName: roomName ?? 'unknown',
    eventType: payload.event,
  });

  // Map LiveKit status to our recording status
  const mappedStatus = mapEgressStatus(livekitStatus);
  if (!mappedStatus) {
    structuredLog('EGRESS_EVENT_SKIPPED', {
      egressId: egressId.slice(0, 20) + '...',
      status: livekitStatus,
      reason: 'Not a terminal egress status',
    });
    return null; // Not a terminal state — skip
  }

  // Find the recording by egress ID
  const { data: recording, error: findError } = await supabase
    .from('recordings')
    .select('recording_id, status')
    .eq('livekit_egress_id', egressId)
    .maybeSingle();

  if (findError) {
    return `Database error looking up recording: ${findError.message}`;
  }

  if (!recording) {
    structuredLog('RECORDING_NOT_FOUND', {
      egressId: egressId.slice(0, 20) + '...',
      hint: 'No recordings row exists for this egress ID. It may have been deleted, or the egress was started outside our system.',
    });
    // Return success — this is a valid state for orphaned egresses
    return null;
  }

  // Idempotency check: if already in a terminal state, skip
  if (recording.status === 'completed' || recording.status === 'failed') {
    structuredLog('IDEMPOTENT_SKIP', {
      recordingId: recording.recording_id,
      currentStatus: recording.status,
      hint: 'Recording is already in a terminal state. Skipping update.',
    });
    return null;
  }

  // Build the update payload
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: mappedStatus,
    updated_at: now,
  };

  if (mappedStatus === 'completed') {
    // Populate duration from the egress metadata
    const durationSeconds = payload.egress?.duration;
    if (durationSeconds && durationSeconds > 0) {
      updates.duration_seconds = durationSeconds;
    }

    // Clear any previous error
    updates.error_message = null;
  } else if (mappedStatus === 'failed') {
    updates.error_message = payload.egress?.error ?? 'Recording failed during processing.';
    updates.retry_count = 0; // Reset retry count; new retry will increment
  }

  // Update the recordings row
  const { error: updateError } = await supabase
    .from('recordings')
    .update(updates)
    .eq('recording_id', recording.recording_id);

  if (updateError) {
    return `Failed to update recording ${recording.recording_id}: ${updateError.message}`;
  }

  structuredLog('RECORDING_UPDATED', {
    recordingId: recording.recording_id,
    newStatus: mappedStatus,
    durationSeconds: updates.duration_seconds as number | undefined,
    errorMessage: updates.error_message as string | undefined,
  });

  return null; // No error
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  structuredLog('WEBHOOK_RECEIVED', {
    method: req.method,
    contentType: req.headers.get('content-type'),
  });

  try {
    // ══════════════════════════════════════════════════════════════════
    // Step 1: Read raw body (must be read BEFORE verification)
    // ══════════════════════════════════════════════════════════════════
    const rawBody = await req.text();

    // ══════════════════════════════════════════════════════════════════
    // Step 2: Verify webhook signature via WebhookReceiver
    // ══════════════════════════════════════════════════════════════════
    const apiKey = Deno.env.get('LIVEKIT_API_KEY');
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    const authHeader = req.headers.get('Authorization');

    let verifiedPayload: LiveKitEgressWebhookPayload | null = null;

    if (apiKey && apiSecret && authHeader) {
      try {
        const receiver = new WebhookReceiver(apiKey, apiSecret);
        const event = await receiver.receive(rawBody, authHeader);
        verifiedPayload = event as unknown as LiveKitEgressWebhookPayload;

        structuredLog('SIGNATURE_VERIFIED', {
          eventType: verifiedPayload.event,
          egressId: verifiedPayload.egress?.egress_id?.slice(0, 20) + '...',
        });
      } catch (verifyErr) {
        const message = verifyErr instanceof Error ? verifyErr.message : 'Unknown verification error';
        structuredLog('SIGNATURE_VERIFICATION_FAILED', {
          error: message,
          hasAuthHeader: !!authHeader,
        });
        return errorResponse(`Webhook signature verification failed: ${message}`, 401);
      }
    } else {
      const missing: string[] = [];
      if (!apiKey) missing.push('LIVEKIT_API_KEY');
      if (!apiSecret) missing.push('LIVEKIT_API_SECRET');
      if (!authHeader) missing.push('Authorization header');

      structuredLog('SIGNATURE_SKIPPED', {
        hint: `Missing: ${missing.join(', ')} — verification disabled (local dev only)`,
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Create Supabase client
    // ══════════════════════════════════════════════════════════════════
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Server configuration error: missing Supabase credentials.', 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Parse payload
    // ══════════════════════════════════════════════════════════════════
    let payload: LiveKitEgressWebhookPayload;
    try {
      payload = verifiedPayload ?? (JSON.parse(rawBody) as LiveKitEgressWebhookPayload);
    } catch {
      return errorResponse('Invalid JSON payload.', 400);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 5: Route event to handler
    // ══════════════════════════════════════════════════════════════════
    const errors: string[] = [];

    // We only handle egress-related events
    if (payload.event?.startsWith('egress.')) {
      const err = await handleEgressEvent(supabase, payload);
      if (err) errors.push(err);
    } else {
      structuredLog('EVENT_SKIPPED', {
        event: payload.event,
        reason: 'Not an egress event. Only egress.* events are handled here.',
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 6: Return response
    // ══════════════════════════════════════════════════════════════════
    const processed = errors.length > 0 ? 0 : 1;

    structuredLog('WEBHOOK_COMPLETE', {
      event: payload.event,
      processed,
      errors: errors.length > 0 ? errors : undefined,
    });

    if (errors.length > 0) {
      return jsonResponse({ success: true, processed: 0, errors }, 200);
    }

    return jsonResponse({ success: true, processed: 1 }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('UNEXPECTED_ERROR', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('An unexpected error occurred.', 500);
  }
});
