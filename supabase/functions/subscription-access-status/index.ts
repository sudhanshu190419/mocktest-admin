// ============================================================================
// Edge Function: subscription-access-status
//
// Single backend endpoint that returns the CURRENT user's subscription
// access summary. Every mobile screen can consume this one response instead
// of re-implementing subscription logic.
//
// ── Authentication ─────────────────────────────────────────────────────────
// verify_jwt = true (default) — the caller must be authenticated.
//
// ── Request ────────────────────────────────────────────────────────────────
//   GET  /functions/v1/subscription-access-status?courseId=<uuid>  (optional)
//   POST /functions/v1/subscription-access-status   (body optional)
//
//   Optional `courseId` (query param or JSON body): when supplied, access is
//   evaluated ONLY for that course (Phase 11G/11H course-scoped model).
//   When omitted, a global summary across all of the student's subscriptions
//   is returned (used by Profile / legacy screens).
//
// ── Response (success) ─────────────────────────────────────────────────────
// {
//   "success": true,
//   "data": {
//     "tier": "grace",
//     "status": "grace",
//     "plan": "NEET Gold Monthly",
//     "hasSubscription": true,
//     "subscriptionId": "uuid",
//     "endDate": "2026-08-03",
//     "graceEndDate": "2026-08-10",
//     "contentAccessEndDate": "2026-09-09",
//     "daysRemaining": 5,
//     "isTrial": false,
//     "canJoinLive": true,
//     "canViewRecorded": true,
//     "canDownloadNotes": true,
//     "canOpenPdf": true,
//     "canAccessCourseLesson": true,
//     "canAccessPyq": true,
//     "canAttemptMockTest": true,
//     "canAttemptPracticeTest": true
//   }
// }
//
// ── Security ───────────────────────────────────────────────────────────────
// The caller's role is resolved authoritatively from profiles (never from a
// client-supplied value). admin / teacher are NOT subscription-gated (full
// access). Only students are evaluated.
//
// ── Environment Variables ──────────────────────────────────────────────────
// SUPABASE_URL              — Auto-injected by Supabase
// SUPABASE_ANON_KEY         — Auto-injected by Supabase (auth verification)
// SUPABASE_SERVICE_ROLE_KEY — Auto-injected by Supabase (DB reads)
//
// @module edge-functions/subscription-access-status
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getSubscriptionAccessSummary } from '../_shared/subscriptionAccess.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ─── Structured Logging ─────────────────────────────────────────────────────

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'subscription-access-status',
      event,
      ...data,
    }),
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 500): Response {
  structuredLog('ACCESS_STATUS_ERROR', { error, statusCode: status });
  return jsonResponse({ success: false, error }, status);
}

// ─── Main Handler ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Allow GET (primary) and POST (mobile convenience)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse('Method not allowed. Use GET or POST.', 405);
  }

  structuredLog('ACCESS_STATUS_REQUEST', { method: req.method });

  try {
    // ── Optional courseId (query param takes precedence over body) ────
    let courseId: string | null = null;
    try {
      const url = new URL(req.url);
      courseId = url.searchParams.get('courseId');
    } catch {
      courseId = null;
    }
    if (!courseId && req.method === 'POST') {
      try {
        const body = (await req.json()) as { courseId?: string };
        courseId = body.courseId ?? null;
      } catch {
        courseId = null; // non-JSON body — ignore
      }
    }
    structuredLog('ACCESS_STATUS_COURSE_SCOPE', { courseId });

    // ── Init Supabase clients ─────────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return errorResponse('Server configuration error.', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
    }

    // Anon client forwards the caller's JWT so getUser() resolves correctly.
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    // Service-role client for authoritative DB reads (explicit profile
    // filter — same pattern as the commerce functions).
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Resolve the authenticated user ────────────────────────────────
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) {
      structuredLog('AUTH_FAILED', {
        error: userError?.message ?? 'No user returned from getUser()',
      });
      return errorResponse('Invalid or expired authentication token.', 401);
    }

    const userId = userData.user.id;
    structuredLog('AUTH_SUCCESS', { userId });

    // ── Compute the access summary ────────────────────────────────────
    // anonClient carries the caller's JWT so the SECURITY DEFINER helper
    // is_permanent_course_owner (migration 096) resolves auth.uid() correctly.
    const summary = await getSubscriptionAccessSummary(adminClient, userId, courseId, anonClient);

    // [DIAGNOSTIC — assigned-notes trace] full summary dump. This is the
    // exact payload the mobile ContentViewer gate consumes — if
    // canDownloadNotes is false here while is_permanent_course_owner is true
    // in the DB, the summary path is the denial layer.
    structuredLog('ACCESS_STATUS_COMPLETE', {
      userId,
      courseScope: courseId ?? 'global',
      tier: summary.tier,
      status: summary.status,
      plan: summary.plan,
      hasSubscription: summary.hasSubscription,
      subscriptionId: summary.subscriptionId,
      endDate: summary.endDate,
      graceEndDate: summary.graceEndDate,
      contentAccessEndDate: summary.contentAccessEndDate,
      daysRemaining: summary.daysRemaining,
      canJoinLive: summary.canJoinLive,
      canViewRecorded: summary.canViewRecorded,
      canDownloadNotes: summary.canDownloadNotes,
      canOpenPdf: summary.canOpenPdf,
      canAccessCourseLesson: summary.canAccessCourseLesson,
      canAccessPyq: summary.canAccessPyq,
      canAttemptMockTests: summary.canAttemptMockTests,
      canAttemptPracticeTest: summary.canAttemptPracticeTest,
    });

    return jsonResponse({ success: true, data: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('UNEXPECTED_ERROR', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('An unexpected error occurred.', 500);
  }
});
