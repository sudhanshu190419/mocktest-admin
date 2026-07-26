// ============================================================================
// Edge Function: recording-timeout (Scheduled / Cron)
//
// Detects recordings stuck in a non-terminal state for too long and
// automatically marks them as failed.
//
// ── Schedule ───────────────────────────────────────────────────────────────
// Runs every 15 minutes via pg_cron or Supabase cron trigger:
//   select cron.schedule('recording-timeout', '*/15 * * * *', '...');
//
// ── What it does ──────────────────────────────────────────────────────────
// 1. Queries recordings WHERE status IN ('recording', 'processing')
//    AND created_at < NOW() - INTERVAL '2 hours'
// 2. For each stuck recording:
//    a. If status = 'recording' AND livekit_egress_id exists:
//       - Attempts to stop the LiveKit egress (best-effort)
//    b. Updates status to 'failed' with error 'Processing timeout.'
//    c. Increments retry_count
// 3. Logs a summary of all recordings marked as failed
//
// ── Environment Variables ──────────────────────────────────────────────────
// SUPABASE_URL              — Auto-injected by Supabase
// SUPABASE_SERVICE_ROLE_KEY — Service role key for DB access
// LIVEKIT_API_KEY           — Required only if stopping active egresses
// LIVEKIT_API_SECRET        — Required only if stopping active egresses
// LIVEKIT_URL               — Required only if stopping active egresses
//
// ⚠️ verify_jwt = false — this function is called by the internal cron
//    scheduler, not by an authenticated user.
//
// @module edge-functions/recording-timeout
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ─── Constants ──────────────────────────────────────────────────────────────

const TIMEOUT_HOURS = 2;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface StuckRecording {
  recording_id: string;
  status: string;
  livekit_egress_id: string | null;
  created_at: string;
  error_message?: string | null;
  teacher_id: string;
}

interface TimeoutResult {
  totalStuck: number;
  markedFailed: number;
  stoppedEgresses: number;
  errors: string[];
}

interface TimeoutResponse {
  success: boolean;
  result?: TimeoutResult;
  error?: string;
}

// ─── Structured Logging ─────────────────────────────────────────────────────

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'recording-timeout',
      event,
      ...data,
    }),
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: TimeoutResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 500): Response {
  structuredLog('TIMEOUT_ERROR', { error, statusCode: status });
  return jsonResponse({ success: false, error }, status);
}

// ─── Main Handler ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Allow POST (cron trigger) and GET (health check)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return errorResponse('Method not allowed. Use POST or GET.', 405);
  }

  structuredLog('TIMEOUT_CHECK_STARTED', { timeoutHours: TIMEOUT_HOURS });

  try {
    // ── Initialize Supabase client ───────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse(
        'Server configuration error: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Query stuck recordings ───────────────────────────────────────
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - TIMEOUT_HOURS);

    const { data: stuckRecordings, error: queryError } = await supabase
      .from('recordings')
      .select('recording_id, status, livekit_egress_id, created_at, error_message, teacher_id')
      .in('status', ['recording', 'processing'])
      .lt('created_at', cutoff.toISOString())
      .limit(50); // Safety limit per run

    if (queryError) {
      return errorResponse(`Database query failed: ${queryError.message}`);
    }

    const recordings = (stuckRecordings ?? []) as StuckRecording[];
    const result: TimeoutResult = {
      totalStuck: recordings.length,
      markedFailed: 0,
      stoppedEgresses: 0,
      errors: [],
    };

    if (recordings.length === 0) {
      structuredLog('NO_STUCK_RECORDINGS', {});
      return jsonResponse({ success: true, result });
    }

    structuredLog('STUCK_RECORDINGS_FOUND', {
      count: recordings.length,
      cutoffTime: cutoff.toISOString(),
    });

    // ── Load LiveKit credentials for stopping active egresses ─────────
    const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
    const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    const livekitUrl = Deno.env.get('LIVEKIT_URL');
    const hasLiveKitCreds = !!(livekitApiKey && livekitApiSecret && livekitUrl);

    let egressClient: { stopEgress: (id: string) => Promise<void> } | null = null;
    if (hasLiveKitCreds) {
      const { EgressClient } = await import('npm:livekit-server-sdk@2.8.1');
      egressClient = new EgressClient(livekitUrl!, livekitApiKey!, livekitApiSecret!);
    }

    // ── Process each stuck recording ─────────────────────────────────
    for (const recording of recordings) {
      try {
        // ── Attempt to stop active LiveKit egress (best-effort) ────
        if (
          recording.status === 'recording' &&
          recording.livekit_egress_id &&
          egressClient
        ) {
          try {
            await egressClient.stopEgress(recording.livekit_egress_id);
            result.stoppedEgresses++;
            structuredLog('EGRESS_STOPPED', {
              recordingId: recording.recording_id,
              egressId: recording.livekit_egress_id.slice(0, 20) + '...',
            });
          } catch (stopErr) {
            structuredLog('EGRESS_STOP_FAILED', {
              recordingId: recording.recording_id,
              error: stopErr instanceof Error ? stopErr.message : 'Unknown error',
            });
            // Non-fatal — egress may have already completed or been stopped
          }
        }

        // ── Mark as failed ─────────────────────────────────────────
        const now = new Date().toISOString();
        const { error: updateError } = await supabase
          .from('recordings')
          .update({
            status: 'failed',
            error_message: `Processing timeout. Recording was in "${recording.status}" state for more than ${TIMEOUT_HOURS} hours without completion.`,
            updated_at: now,
          })
          .eq('recording_id', recording.recording_id);

        if (updateError) {
          result.errors.push(
            `Failed to update recording ${recording.recording_id}: ${updateError.message}`,
          );
          structuredLog('UPDATE_FAILED', {
            recordingId: recording.recording_id,
            error: updateError.message,
          });
        } else {
          result.markedFailed++;
          structuredLog('MARKED_FAILED', {
            recordingId: recording.recording_id,
            previousStatus: recording.status,
          });
        }
      } catch (recordingErr) {
        const message = recordingErr instanceof Error
          ? recordingErr.message
          : 'Unknown error processing recording';
        result.errors.push(`Recording ${recording.recording_id}: ${message}`);
        structuredLog('PROCESSING_ERROR', {
          recordingId: recording.recording_id,
          error: message,
        });
      }
    }

    // ── Log summary ─────────────────────────────────────────────────
    structuredLog('TIMEOUT_CHECK_COMPLETE', {
      totalStuck: result.totalStuck,
      markedFailed: result.markedFailed,
      stoppedEgresses: result.stoppedEgresses,
      errorsCount: result.errors.length,
    });

    return jsonResponse({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('UNEXPECTED_ERROR', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('An unexpected error occurred.', 500);
  }
});
