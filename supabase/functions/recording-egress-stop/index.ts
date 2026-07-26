// ============================================================================
// Edge Function: recording-egress-stop
//
// Stops an active LiveKit Egress recording by its egress ID.
// Updates the recordings table status to 'processing' after successful stop.
//
// ── Authentication ─────────────────────────────────────────────────────────
// verify_jwt = true (configured in config.toml)
//
// The caller must be an authenticated teacher who owns the recording.
//
// ── Request Body ───────────────────────────────────────────────────────────
// {
//   "egressId": "EG_xxxxxxxx"   // LiveKit Egress ID to stop
// }
//
// ── Response ───────────────────────────────────────────────────────────────
// { "success": true }
//
// ── Environment Variables ──────────────────────────────────────────────────
// LIVEKIT_API_KEY             — LiveKit API key (required)
// LIVEKIT_API_SECRET          — LiveKit API secret (required)
// LIVEKIT_URL                 — LiveKit server URL (required)
// SUPABASE_URL                — Auto-injected by Supabase
// SUPABASE_SERVICE_ROLE_KEY   — Service role key for DB access
//
// @module edge-functions/recording-egress-stop
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { EgressClient } from 'npm:livekit-server-sdk@2.8.1';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface StopEgressRequest {
  /** LiveKit Egress ID to stop. */
  egressId: string;
}

interface StopEgressSuccessResponse {
  success: true;
}

interface StopEgressErrorResponse {
  error: string;
}

type FunctionResponse = StopEgressSuccessResponse | StopEgressErrorResponse;

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
      service: 'recording-egress-stop',
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
  structuredLog('EGRESS_STOP_ERROR', { error, statusCode: status });
  return jsonResponse({ error }, status);
}

/**
 * Validate that the caller is authenticated as a teacher.
 */
async function authenticateTeacher(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
): Promise<{ teacherId: string; profileId: string } | { error: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header.' };
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: authError?.message ?? 'Authentication failed.' };
  }

  const profileId = user.id;

  const { data: teacher, error: teacherError } = await supabase
    .from('teacher_details')
    .select('teacher_id')
    .eq('profile_id', profileId)
    .single();

  if (teacherError || !teacher) {
    return { error: 'User is not a registered teacher.' };
  }

  return { teacherId: teacher.teacher_id, profileId };
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

  structuredLog('REQUEST_RECEIVED', { method: req.method });

  try {
    // ══════════════════════════════════════════════════════════════════
    // Step 1: Parse request body
    // ══════════════════════════════════════════════════════════════════
    let egressId: string;
    try {
      const raw = await req.json() as Record<string, unknown>;
      if (!raw.egressId || typeof raw.egressId !== 'string') {
        return errorResponse('Missing or invalid field: egressId (string required).');
      }
      egressId = raw.egressId;
      structuredLog('REQUEST_VALIDATED', { egressId: egressId.slice(0, 20) + '...' });
    } catch {
      return errorResponse('Invalid request body. Expected valid JSON.', 400);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 2: Authenticate
    // ══════════════════════════════════════════════════════════════════
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Server configuration error: missing Supabase credentials.', 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authResult = await authenticateTeacher(
      supabase,
      req.headers.get('Authorization'),
    );

    if ('error' in authResult) {
      return errorResponse(authResult.error, 403);
    }

    structuredLog('AUTH_SUCCESS', { teacherId: authResult.teacherId });

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Verify the egress belongs to this teacher's recording
    // ══════════════════════════════════════════════════════════════════
    const { data: recording, error: recordingError } = await supabase
      .from('recordings')
      .select('recording_id, teacher_id, status')
      .eq('livekit_egress_id', egressId)
      .single();

    if (recordingError || !recording) {
      // Egress not found in our DB — that's okay, we can still try to stop it
      // at the LiveKit level. This allows manual cleanup of orphaned egresses.
      structuredLog('RECORDING_NOT_FOUND', {
        egressId: egressId.slice(0, 20) + '...',
        hint: 'Egress ID not found in recordings table. Will attempt LiveKit stop only.',
      });
    } else {
      // Verify teacher ownership
      if (recording.teacher_id !== authResult.teacherId) {
        return errorResponse('You do not have permission to stop this recording.', 403);
      }

      if (recording.status !== 'recording') {
        // Still attempt to stop at LiveKit level, but warn
        structuredLog('RECORDING_NOT_ACTIVE', {
          recordingId: recording.recording_id,
          currentStatus: recording.status,
          hint: 'Recording status is not "recording". Attempting LiveKit stop anyway.',
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Get LiveKit credentials and stop the egress
    // ══════════════════════════════════════════════════════════════════
    const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
    const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    const livekitUrl = Deno.env.get('LIVEKIT_URL');

    if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
      return errorResponse('Server configuration error: missing LiveKit credentials.', 500);
    }

    try {
      const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
      await egressClient.stopEgress(egressId);

      structuredLog('EGRESS_STOPPED', {
        egressId: egressId.slice(0, 20) + '...',
      });
    } catch (livekitErr) {
      structuredLog('LIVEKIT_STOP_FAILED', {
        error: livekitErr instanceof Error ? livekitErr.message : 'Unknown LiveKit error',
        egressId: egressId.slice(0, 20) + '...',
      });
      // Don't throw — the egress may already be complete. We still update
      // the DB to 'processing' so the webhook can finalize it.
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 5: Update recordings table status to 'processing'
    // ══════════════════════════════════════════════════════════════════
    if (recording?.recording_id) {
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('recordings')
        .update({ status: 'processing', updated_at: now })
        .eq('recording_id', recording.recording_id);

      if (updateError) {
        structuredLog('DB_UPDATE_FAILED', {
          recordingId: recording.recording_id,
          error: updateError.message,
        });
        // Non-fatal — the egress is stopped, webhook will resolve status
      } else {
        structuredLog('DB_UPDATED', {
          recordingId: recording.recording_id,
          newStatus: 'processing',
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 6: Return success
    // ══════════════════════════════════════════════════════════════════
    return jsonResponse({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('UNEXPECTED_ERROR', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('An unexpected error occurred.', 500);
  }
});
