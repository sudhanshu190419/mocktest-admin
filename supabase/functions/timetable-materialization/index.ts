// ============================================================================
// Edge Function: timetable-materialization (Scheduled / Cron)
//
// Daily backend job that turns recurring `timetable_slots` rules into actual
// `live_classes` occurrences for every institute, using a ROLLING window:
//
//   current_date → current_date + 60 days
//
// It is invoked by the `timetable-materialization-daily` pg_cron job
// (migration 110) via net.http_post — WITHOUT an Authorization header, so the
// function is deployed with `verify_jwt = false` (config.toml), mirroring the
// subscription-lifecycle scheduler (migrations 097/104).
//
// The function itself is a thin orchestrator: it NEVER decides what to
// create. It only resolves the institutes that have active slots and calls
// the EXISTING SECURITY DEFINER RPC `materialize_institute_timetable`
// (migration 108) with a service-role client. That RPC owns:
//
//   - authorization (super/academic admin OR service_role)
//   - institute scoping (per-institute, multi-tenant safe)
//   - timezone conversion (institutes.timezone, default Asia/Kolkata)
//   - holiday / teacher-leave skipping
//   - validity-window intersection
//   - idempotency (uq_live_classes_timetable_occurrence + ON CONFLICT)
//
// Multi-institute safety: institutes are discovered from the DATA
// (timetable_slots where status = 'active') — an institute_id is NEVER read
// from the HTTP request body, so a caller cannot target another institute.
// Each institute is materialized independently, so a failure in one does not
// affect the others.
//
// Idempotency: re-runs, overlapping cron deliveries, and manual invocations
// are all SAFE — repeated materialization cannot create duplicate
// live_classes (partial unique index on (timetable_slot_id, scheduled_at)).
//
// @module edge-functions/timetable-materialization
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Rolling materialization window (days). Keeps DB growth bounded. */
const MATERIALIZATION_WINDOW_DAYS = 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface MaterializationResult {
  success: boolean;
  /** Number of institutes processed. */
  institutes: number;
  /** Total live_classes created across all institutes. */
  totalCreated: number;
  /** Per-institute failure messages (never thrown, so the job continues). */
  errors: string[];
  /** Total wall-clock duration of the invocation in milliseconds. */
  executionTimeMs: number;
}

// ─── Logging ────────────────────────────────────────────────────────────────

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'timetable-materialization',
      event,
      ...data,
    }),
  );
}

// ─── Response helpers ───────────────────────────────────────────────────────

function jsonResponse(body: MaterializationResult, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 500): Response {
  return jsonResponse({
    success: false,
    institutes: 0,
    totalCreated: 0,
    errors: [error],
    executionTimeMs: 0,
  }, status);
}

/**
 * Returns the date-only (YYYY-MM-DD) of a Date in Asia/Kolkata — the
 * institute default timezone (migration 108). Using the LOCAL calendar date
 * (instead of the UTC date) keeps the materialization window aligned with
 * the institute day: at 00:00 UTC the UTC date matches IST, but manual
 * invocations between 18:30–23:59 UTC would otherwise be one day behind.
 * The window is a rolling range clamped by each slot's validity and the
 * day-of-week filter, so a ±1-day boundary shift is harmless and the daily
 * cron self-heals it — multi-timezone institutes remain safe.
 */
function toDateOnly(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// ─── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // POST is the cron contract; GET is allowed for health checks / manual
  // runs (same as subscription-lifecycle).
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
      return errorResponse('Server configuration error.', 500);
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Resolve institutes from the DATA — never from the request body ─
    const { data: institutes, error: instErr } = await adminClient
      .from('timetable_slots')
      .select('institute_id')
      .eq('status', 'active');

    if (instErr) {
      structuredLog('INSTITUTES_RESOLVE_FAILED', { error: instErr.message });
      return errorResponse(`Failed to resolve active institutes: ${instErr.message}`, 500);
    }

    const instituteIds = [
      ...new Set((institutes ?? []).map((r) => (r as { institute_id: string }).institute_id)),
    ].filter(Boolean) as string[];

    structuredLog('INSTITUTES_RESOLVED', { count: instituteIds.length });

    const fromDate = toDateOnly(new Date());
    const toDate = toDateOnly(new Date(Date.now() + MATERIALIZATION_WINDOW_DAYS * 24 * 60 * 60 * 1000));

    let totalCreated = 0;
    const errors: string[] = [];

    for (const instituteId of instituteIds) {
      const { data, error } = await adminClient.rpc('materialize_institute_timetable', {
        p_institute_id: instituteId,
        p_from_date: fromDate,
        p_to_date: toDate,
      });

      if (error) {
        errors.push(`${instituteId}: ${error.message}`);
        structuredLog('INSTITUTE_MATERIALIZATION_FAILED', {
          instituteId,
          error: error.message,
        });
        continue; // Other institutes are unaffected.
      }

      const created = Number(data ?? 0);
      totalCreated += created;
      structuredLog('INSTITUTE_MATERIALIZED', { instituteId, created });
    }

    const executionTimeMs = Date.now() - startedAt;

    structuredLog('JOB_COMPLETED', {
      institutes: instituteIds.length,
      totalCreated,
      errors: errors.length,
      executionTimeMs,
    });

    return jsonResponse({
      success: true,
      institutes: instituteIds.length,
      totalCreated,
      errors,
      executionTimeMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('JOB_FAILED', { error: message });
    return errorResponse(message, 500);
  }
});
