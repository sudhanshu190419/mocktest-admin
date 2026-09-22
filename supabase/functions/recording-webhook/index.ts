// ============================================================================
// Edge Function: recording-webhook
//
// Receives webhook events from LiveKit Cloud related to recording (egress)
// lifecycle. This function handles the following events:
//
//   - egress.completed  → Finalizes the recordings row to 'completed', but
//                         ONLY when the row already owns a storage artifact
//                         (storage_path / provider_recording_url). The
//                         payload carries no artifact location, so
//                         artifact-less completions stay in processing.
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
interface LiveKitEgressInfo {
  egressId?: string;
  egress_id?: string;
  roomName?: string;
  room_name?: string;
  status?: number | string;
  error?: string;
  fileResults?: Array<{
    filename?: string;
    duration?: number;
    size?: number;
    location?: string;
  }>;
}

interface LiveKitEgressWebhookPayload {
  /** LiveKit webhook event name. */
  event: string;

  /** Egress information for egress_* webhook events. */
  egressInfo?: LiveKitEgressInfo;

  /** Some webhook payloads may also contain room information. */
  room?: {
    name?: string;
    sid?: string;
  };

  id?: string;
  createdAt?: number;
  created_at?: number;
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
// Diagnostic-only helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a value returned by the LiveKit SDK/protobuf layer so it is safe
 * for JSON.stringify. Protobuf int64 fields (timestamps, durations, sizes)
 * arrive as `bigint`, which JSON.stringify throws on.
 *
 * Diagnostic logging only — never affects business logic.
 */
function toLogSafe(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/** Loose view of the egress info on a verified webhook event (diagnostics only). */
interface WebhookEgressLogInfo {
  egressId?: string;
  egress_id?: string;
  status?: { toString(): string } | string | number;
  duration?: unknown;
  error?: string;
}

/**
 * Loose view of the verified `WebhookEvent` used only for diagnostic logging.
 * The proto field is `egress_info` (parsed as `egressInfo`); some payload
 * shapes may expose it as `egress`, so both are checked.
 */
interface WebhookVerifiedLogEvent {
  event?: string;
  room?: { name?: string };
  egress?: WebhookEgressLogInfo;
  egressInfo?: WebhookEgressLogInfo;
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
  livekitStatus: unknown,
): 'completed' | 'failed' | null {
  const status =
    typeof livekitStatus === 'number'
      ? livekitStatus
      : Number(livekitStatus);

  switch (status) {
    case 3: // EGRESS_COMPLETE
      return 'completed';

    case 4: // EGRESS_FAILED
    case 5: // EGRESS_ABORTED
    case 6: // EGRESS_LIMIT_REACHED
      return 'failed';

    default:
      structuredLog('UNRECOGNIZED_EGRESS_STATUS', {
        status: livekitStatus,
        hint: 'Received a non-terminal or unrecognized LiveKit egress status. Recording will not be updated.',
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
 * Updates the corresponding recordings row with the final status, and —
 * for completions — the duration and `completed_at`. A completion is only
 * applied when the row already owns a storage artifact, because
 * public.recordings requires storage_path or provider_recording_url for
 * status='completed'.
 */
async function handleEgressEvent(
  supabase: ReturnType<typeof createClient>,
  payload: LiveKitEgressWebhookPayload,
): Promise<string | null> {
  const egressInfo = payload.egressInfo;

const egressId =
  egressInfo?.egressId ??
  egressInfo?.egress_id;

const livekitStatus = egressInfo?.status;

const roomName =
  payload.room?.name ??
  egressInfo?.roomName ??
  egressInfo?.room_name;

if (!egressId || livekitStatus === undefined || livekitStatus === null) {
  structuredLog('EGRESS_WEBHOOK_INVALID', {
    event: payload.event,
    hasEgressInfo: Boolean(egressInfo),
    egressId: egressId ?? null,
    status: livekitStatus ?? null,
    roomName: roomName ?? null,
  });

  return 'Missing egressId or status in webhook payload';
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
    .select('recording_id, status, storage_path, provider_recording_url')
    .eq('livekit_egress_id', egressId)
    .maybeSingle();

  structuredLog('WEBHOOK_RECORDING_LOOKUP', {
    egressId,
    found: Boolean(recording),
    recordingId: recording?.recording_id || null,
    currentStatus: recording?.status || null,
    hasStoragePath: Boolean(recording?.storage_path),
    hasProviderRecordingUrl: Boolean(recording?.provider_recording_url),
  });

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

  if (mappedStatus === 'completed') {
    // ── Artifact guard ──────────────────────────────────────────────────
    // public.recordings requires storage_path OR provider_recording_url to
    // be non-NULL when status='completed'. The LiveKit egress webhook
    // payload carries no storage/output location, and a path must never be
    // fabricated from room.name / filePrefix. Complete only when the row
    // already owns an artifact (for example finalized by an artifact-aware
    // path); otherwise leave the row in its current state so a later
    // artifact-aware path can finalize it.
    const hasArtifact =
      Boolean(recording.storage_path) || Boolean(recording.provider_recording_url);

    if (!hasArtifact) {
      structuredLog('EGRESS_COMPLETE_WITHOUT_ARTIFACT', {
        recordingId: recording.recording_id,
        egressId: egressId.slice(0, 20) + '...',
        currentStatus: recording.status,
        hint: 'Egress completed but no storage_path / provider_recording_url is available. Recording left in its current state for a later artifact-aware finalization.',
      });
      return null;
    }
  }

  const updates: Record<string, unknown> = {
    status: mappedStatus,
    updated_at: now,
  };

  if (mappedStatus === 'completed') {
    // status='completed' requires completed_at (ck_recordings_status_completed)
    updates.completed_at = now;

    // Populate duration from the egress metadata
    const durationNanoseconds = egressInfo?.fileResults?.[0]?.duration;

if (
  typeof durationNanoseconds === 'number' &&
  durationNanoseconds > 0
) {
  updates.duration_seconds = durationNanoseconds / 1_000_000_000;
}
    // Clear any previous error
    updates.error_message = null;
  } else if (mappedStatus === 'failed') {
    updates.error_message =
  egressInfo?.error ?? 'Recording failed during processing.';
    updates.retry_count = 0; // Reset retry count; new retry will increment
  }

  structuredLog('WEBHOOK_COMPLETION_ATTEMPT', {
    egressId,
    recordingId: recording?.recording_id || null,
    mappedStatus,
    hasStoragePath: Boolean(recording?.storage_path),
    hasProviderRecordingUrl: Boolean(recording?.provider_recording_url),
  });

  // Update the recordings row
  const { error: updateError } = await supabase
    .from('recordings')
    .update(updates)
    .eq('recording_id', recording.recording_id);

  if (updateError) {
    structuredLog('WEBHOOK_DB_UPDATE_FAILED', {
      egressId,
      recordingId: recording.recording_id,
      error: updateError?.message,
      code: updateError?.code,
      details: updateError?.details,
      hint: updateError?.hint,
    });
    return `Failed to update recording ${recording.recording_id}: ${updateError.message}`;
  }

  structuredLog('WEBHOOK_DB_UPDATE_SUCCESS', {
    egressId,
    recordingId: recording.recording_id,
    newStatus: mappedStatus,
  });

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
  // Diagnostic: log every request before anything else — including before
  // webhook signature verification. Never logs the Authorization value itself.
  structuredLog('WEBHOOK_REQUEST_RECEIVED', {
    method: req.method,
    contentType: req.headers.get('content-type'),
    hasAuthorization: Boolean(req.headers.get('authorization')),
    userAgent: req.headers.get('user-agent'),
  });

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

        const verifiedLogEvent = event as unknown as WebhookVerifiedLogEvent;
        const verifiedEgress = verifiedLogEvent.egressInfo ?? verifiedLogEvent.egress;
        structuredLog('WEBHOOK_VERIFIED', {
          event: verifiedLogEvent.event || null,
          egressId: verifiedEgress?.egressId || verifiedEgress?.egress_id || null,
          egressStatus:
            verifiedEgress?.status?.toString?.() ??
            verifiedEgress?.status ??
            null,
          roomName: verifiedLogEvent.room?.name || null,
          duration: toLogSafe(verifiedEgress?.duration) || null,
          egressError: verifiedEgress?.error || null,
        });

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
        structuredLog('WEBHOOK_VERIFICATION_FAILED', {
          error: message,
          hasAuthorization: Boolean(req.headers.get('authorization')),
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
   // We only handle egress-related events
if (
  payload.event === 'egress_started' ||
  payload.event === 'egress_updated' ||
  payload.event === 'egress_ended'
) {
  const err = await handleEgressEvent(supabase, payload);
  if (err) errors.push(err);
} else {
  structuredLog('EVENT_SKIPPED', {
    event: payload.event,
    reason:
      'Not an egress event. Only egress_started, egress_updated and egress_ended are handled here.',
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
