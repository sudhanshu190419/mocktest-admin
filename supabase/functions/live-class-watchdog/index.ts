// ============================================================================
// Edge Function: live-class-watchdog (Scheduled / Cron)
//
// Abandoned-class watchdog that runs every 5 minutes to prevent live classes
// from remaining status='live' forever when the teacher disappears (browser
// crash, laptop shutdown, internet failure, Wi-Fi change, tab closure, OS
// suspension, unexpected disconnect).
//
// It is invoked by the `live-class-watchdog` pg_cron job (migration 112) via
// net.http_post — WITHOUT an Authorization header, so the function is deployed
// with `verify_jwt = false` (config.toml), mirroring the subscription-lifecycle
// and timetable-materialization schedulers (migrations 097/104/110).
//
// The function is a thin orchestrator: it resolves institutes that have active
// or scheduled live classes, calls the EXISTING SECURITY DEFINER RPC
// `recover_stale_live_classes` (migration 112) with a service-role client, and
// stops active egress for recovered classes. The RPC owns:
//
//   - authorization (service_role only)
//   - institute scoping (per-institute, multi-tenant safe)
//   - heartbeat staleness detection (15-minute threshold)
//   - hard-cap enforcement (scheduled_at + duration_min + 15 min)
//   - never-started scheduled-class expiry (→ cancelled)
//   - idempotency (atomic WHERE status='live' claims + ON CONFLICT)
//
// Multi-institute safety: institutes are discovered from the DATA
// (live_classes where status IN ('live','scheduled')) — an institute_id is
// NEVER read from the HTTP request body, so a caller cannot target another
// institute. Each institute is recovered independently, so a failure in one
// does not affect the others.
//
// Idempotency: re-runs, overlapping cron deliveries, and manual invocations
// are all SAFE — repeated recovery cannot double-transition or double-finalize
// a class.
//
// @module edge-functions/live-class-watchdog
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ─── Constants ──────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface WatchdogResult {
  success: boolean;
  /** Number of institutes processed. */
  institutes: number;
  /** Live classes recovered (stale/hard-capped → completed). */
  recoveredLiveClasses: number;
  /** Never-started scheduled classes expired (→ cancelled). */
  expiredScheduledClasses: number;
  /** Attendance finalizations performed. */
  attendanceFinalized: number;
  /** Active egresses stopped. */
  egressStopped: number;
  /** Per-institute failure messages (never thrown, so the job continues). */
  errors: string[];
  /** Total wall-clock duration of the invocation in milliseconds. */
  executionTimeMs: number;
}

/** Shape of the RPC result per institute. */
interface RecoverResult {
  success: boolean;
  code: string;
  recoveredLiveClasses?: number;
  expiredScheduledClasses?: number;
  attendanceFinalized?: number;
  recoveredClassIds?: string[];
  errors?: Array<{ class_id: string; step: string; error: string }>;
  message?: string;
}

/** Shape of a recording row from the DB. */
interface RecordingRow {
  recording_id: string;
  livekit_egress_id: string | null;
}

// ─── Logging ────────────────────────────────────────────────────────────────

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'live-class-watchdog',
      event,
      ...data,
    }),
  );
}

// ─── Response helpers ───────────────────────────────────────────────────────

function jsonResponse(body: WatchdogResult, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 500): Response {
  return jsonResponse({
    success: false,
    institutes: 0,
    recoveredLiveClasses: 0,
    expiredScheduledClasses: 0,
    attendanceFinalized: 0,
    egressStopped: 0,
    errors: [error],
    executionTimeMs: 0,
  }, status);
}

// ─── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // POST is the cron contract; GET is allowed for health checks / manual
  // runs (same as timetable-materialization and subscription-lifecycle).
  if (req.method !== 'POST' && req.method !== 'GET') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  const startedAt = Date.now();
  structuredLog('JOB_STARTED', { method: req.method });

  try {
    // ── Service-role client (server-side only — never exposed to the
    //    frontend). Used to invoke the SECURITY DEFINER RPCs. ──────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Server configuration error: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.', 500);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Resolve institutes from the DATA — never from the request body ─
    const { data: instituteRows, error: instErr } = await adminClient
      .from('live_classes')
      .select('institute_id')
      .in('status', ['live', 'scheduled']);

    if (instErr) {
      structuredLog('INSTITUTES_RESOLVE_FAILED', { error: instErr.message });
      return errorResponse(`Failed to resolve institutes: ${instErr.message}`, 500);
    }

    const instituteIds = [
      ...new Set((instituteRows ?? []).map((r) => (r as { institute_id: string }).institute_id)),
    ].filter(Boolean) as string[];

    structuredLog('INSTITUTES_RESOLVED', { count: instituteIds.length });

    let totalRecovered = 0;
    let totalExpired = 0;
    let totalFinalized = 0;
    let totalEgressStopped = 0;
    const errors: string[] = [];

    // ── LiveKit egress client (lazy — only if LiveKit creds exist) ──
    const livekitUrl = Deno.env.get('LIVEKIT_URL');
    const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
    const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    const hasLiveKitCreds = !!(livekitApiKey && livekitApiSecret && livekitUrl);

    // Iterate institutes (one failure never blocks the others)
    for (const instituteId of instituteIds) {
      const { data, error } = await adminClient.rpc('recover_stale_live_classes', {
        p_institute_id: instituteId,
      });

      if (error) {
        errors.push(`${instituteId}: RPC error: ${error.message}`);
        structuredLog('INSTITUTE_RECOVERY_FAILED', {
          instituteId,
          error: error.message,
        });
        continue;
      }

      const result = data as RecoverResult | null;

      if (!result || !result.success) {
        const msg = result?.message ?? 'Unknown error';
        errors.push(`${instituteId}: ${msg}`);
        structuredLog('INSTITUTE_RECOVERY_REJECTED', {
          instituteId,
          message: msg,
        });
        continue;
      }

      const recovered = result.recoveredLiveClasses ?? 0;
      const expired = result.expiredScheduledClasses ?? 0;
      const finalized = result.attendanceFinalized ?? 0;

      totalRecovered += recovered;
      totalExpired += expired;
      totalFinalized += finalized;

      structuredLog('INSTITUTE_RECOVERED', {
        instituteId,
        recoveredLiveClasses: recovered,
        expiredScheduledClasses: expired,
        attendanceFinalized: finalized,
      });

      // ── Stop active egress for every recovered class ─────────────
      const recoveredClassIds = result.recoveredClassIds ?? [];
      if (recoveredClassIds.length > 0 && hasLiveKitCreds) {
        const { EgressClient } = await import('npm:livekit-server-sdk@2.8.1');
        const egressClient = new EgressClient(livekitUrl!, livekitApiKey!, livekitApiSecret!);

        const { data: recordings, error: recErr } = await adminClient
          .from('recordings')
          .select('recording_id, livekit_egress_id')
          .in('class_id', recoveredClassIds)
          .eq('status', 'recording');

        if (recErr) {
          structuredLog('RECORDINGS_QUERY_FAILED', {
            instituteId,
            error: recErr.message,
          });
        } else if (recordings && recordings.length > 0) {
          for (const rec of recordings as RecordingRow[]) {
            if (rec.livekit_egress_id) {
              try {
                await egressClient.stopEgress(rec.livekit_egress_id);
                totalEgressStopped++;
                structuredLog('EGRESS_STOPPED', {
                  instituteId,
                  recordingId: rec.recording_id,
                  egressId: rec.livekit_egress_id.slice(0, 20) + '...',
                });
              } catch (stopErr) {
                const msg = stopErr instanceof Error ? stopErr.message : 'Unknown error';
                structuredLog('EGRESS_STOP_FAILED', {
                  instituteId,
                  recordingId: rec.recording_id,
                  error: msg,
                });
                // Non-fatal — egress may have already completed or been stopped
              }
            }
          }
        }
      }
    }

    const executionTimeMs = Date.now() - startedAt;

    structuredLog('JOB_COMPLETED', {
      institutes: instituteIds.length,
      recoveredLiveClasses: totalRecovered,
      expiredScheduledClasses: totalExpired,
      attendanceFinalized: totalFinalized,
      egressStopped: totalEgressStopped,
      errors: errors.length,
      executionTimeMs,
    });

    return jsonResponse({
      success: true,
      institutes: instituteIds.length,
      recoveredLiveClasses: totalRecovered,
      expiredScheduledClasses: totalExpired,
      attendanceFinalized: totalFinalized,
      egressStopped: totalEgressStopped,
      errors,
      executionTimeMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('JOB_FAILED', { error: message });
    return errorResponse(message, 500);
  }
});