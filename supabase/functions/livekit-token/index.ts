// ============================================================================
// Edge Function: livekit-token
//
// Generates a signed LiveKit Access Token for authentication with a
// LiveKit room. Single backend entry point for teacher, student and admin
// clients (web & mobile) to obtain a LiveKit JWT.
//
// ── Authentication ─────────────────────────────────────────────────────────
// verify_jwt = true (default, configured in config.toml). The Edge Runtime
// rejects unauthenticated requests before this handler runs. We additionally
// call supabase.auth.getUser() to resolve the authenticated user's UUID
// (profile_id), which becomes the LiveKit participant identity.
//
// ── Security Model (Phase 11J.2 — Class-Scoped Authorization) ─────────────
// The client NEVER chooses which room receives the token. The server derives
// everything itself:
//
//     JWT
//       ↓
//     authenticated user (user.id)
//       ↓
//     profiles                → authoritative role (never from the request body)
//       ↓
//     live_classes (classId)  → class_id, status, room_name, teacher_id
//       ↓
//     batch_subject_live_classes → batch_subject_ids
//       ↓
//     batch_subjects          → batch_ids (is_active = true)
//       ↓
//     course_batches          → course_id(s)
//       ↓
//     authorization
//
//   • Student:  allowed ONLY when BOTH hold:
//                 (a) an ACTIVE batch_students row in one of the class's
//                     batches, AND
//                 (b) can_student_access_live_course(course_id) is TRUE for
//                     at least one course linked to the class's batches
//                     (ANY-course semantics — same rule the RLS helpers use).
//               The class must have started (status = 'live').
//   • Teacher:  allowed ONLY for classes they own AND that have been started
//               through start_scheduled_live_class() (status = 'live' AND
//               room_name persisted). Phase 1 — no more derived-room bypass.
//   • Admin:    full bypass.
//
// ── Room Handling ──────────────────────────────────────────────────────────
// The token's room grant is ALWAYS live_classes.room_name loaded from the
// database. Any client-supplied room name is ignored. If room_name is NULL
// (class not started) an error is returned — EXCEPT for the admin tooling
// edge, where an admin may derive the deterministic room from class_id
// (`class-` + first 8 hex chars of class_id). Teachers no longer receive a
// derived room: they must have started the class through
// start_scheduled_live_class() first (which persists status='live' and
// room_name). Students never get a derived room — for them NULL room_name
// always means "not started".
//
// ── Request Body (Phase 11J.2 contract) ────────────────────────────────────
// {
//   "classId": "…",              // live_classes.class_id — server-resolved
//   "participantName": "Rahul"   // display name shown in the LiveKit UI
// }
//
// Legacy fields (roomName, role) are IGNORED. The authoritative role is
// always re-derived from profiles; roomName is never trusted.
//
// ── Response ───────────────────────────────────────────────────────────────
// {
//   "token": "<livekit-jwt>",
//   "url": "wss://<project>.livekit.cloud"
// }
//
// ── Environment Variables ──────────────────────────────────────────────────
// LIVEKIT_API_KEY       — LiveKit API key (required)
// LIVEKIT_API_SECRET    — LiveKit API secret (required)
// LIVEKIT_URL           — LiveKit WebSocket URL (required)
// SUPABASE_URL          — Auto-injected by Supabase
// SUPABASE_ANON_KEY     — Auto-injected by Supabase
// SUPABASE_SERVICE_ROLE_KEY — Auto-injected by Supabase
//
// @module edge-functions/livekit-token
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2.8.1';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface TokenRequestBody {
  /** live_classes.class_id — the ONLY authorization input from the client. */
  classId: string;
  /** Display name for the participant shown in the LiveKit UI. */
  participantName: string;
}

interface LiveClassRow {
  class_id: string;
  institute_id: string;
  teacher_id: string;
  status: string;
  room_name: string | null;
}

interface TokenSuccessResponse {
  /** Signed LiveKit JWT. */
  token: string;
  /** WebSocket URL of the LiveKit server. */
  url: string;
}

interface TokenErrorResponse {
  /** Error message describing what went wrong. */
  error: string;
}

type TokenResponse = TokenSuccessResponse | TokenErrorResponse;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Standardized user-facing denial message (matches Phase 11C MESSAGES). */
const LIVE_BLOCKED_MESSAGE =
  'Your subscription has expired. Renew to continue attending live classes.';

// ═══════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'livekit-token',
      event,
      ...data,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function jsonResponse(body: TokenResponse, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(message: string, status: number): Response {
  structuredLog('TOKEN_ERROR', {
    error: message,
    statusCode: status,
  });
  return jsonResponse({ error: message }, status);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Deterministic room name derived from a class_id.
 *
 * Mirrors the client-side pattern (teacherLiveClassService.buildRoomName /
 * useLiveClass.buildRoomName): `class-` + first 8 hex chars of the UUID.
 * Used ONLY for the teacher/admin instant-go-live edge, where a token is
 * requested before live_classes.room_name has been persisted. Students never
 * receive a derived room.
 */
function buildRoomName(classId: string): string {
  const short = classId.replace(/-/g, '').slice(0, 8);
  return `class-${short}`;
}

/**
 * Class-scoped student authorization.
 *
 * Both conditions must hold:
 *   1. The student holds an ACTIVE batch_students row in one of the class's
 *      batches (batch_subject_live_classes → batch_subjects, is_active).
 *   2. can_student_access_live_course(course_id) is TRUE for at least one
 *      course linked to those batches (ANY-course semantics).
 *
 * All lookups use the service-role client (never trusts the client). The
 * entitlement check reuses the existing RLS helper can_student_access_live_course
 * — which depends on auth.uid() — so it is invoked through the ANON client
 * that forwards the caller's JWT. Any RPC error fails CLOSED (denied).
 */
async function authorizeStudent(
  anonClient: ReturnType<typeof createClient>,
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  liveClass: LiveClassRow,
): Promise<{ allowed: boolean; message?: string }> {
  // ── 1. The class must have started ────────────────────────────────────
  if (liveClass.status !== 'live') {
    return { allowed: false, message: 'This class has not started yet.' };
  }

  // ── 2. Resolve the student's student_id ───────────────────────────────
  const { data: student } = await serviceClient
    .from('student_details')
    .select('student_id')
    .eq('profile_id', userId)
    .maybeSingle();

  if (!student?.student_id) {
    return { allowed: false, message: 'Student profile not found.' };
  }

  // ── 3. Resolve the class's batch_subject_ids ──────────────────────────
  const { data: bsRows } = await serviceClient
    .from('batch_subject_live_classes')
    .select('batch_subject_id')
    .eq('class_id', liveClass.class_id);

  const batchSubjectIds = (bsRows ?? []).map((r: any) => r.batch_subject_id);
  if (batchSubjectIds.length === 0) {
    return { allowed: false, message: 'This class is not assigned to any batch.' };
  }

  // ── 4. Resolve batch_ids (active batch-subjects only) ─────────────────
  const { data: bsList } = await serviceClient
    .from('batch_subjects')
    .select('batch_id')
    .in('batch_subject_id', batchSubjectIds)
    .eq('is_active', true);

  const batchIds = [...new Set((bsList ?? []).map((r: any) => r.batch_id))] as string[];
  if (batchIds.length === 0) {
    return { allowed: false, message: 'This class is not assigned to any active batch.' };
  }

  // ── 5. Batch membership — student must be ACTIVE in one of THESE batches ─
  const { data: membership } = await serviceClient
    .from('batch_students')
    .select('batch_id')
    .in('batch_id', batchIds)
    .eq('student_id', student.student_id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { allowed: false, message: 'You are not assigned to this class.' };
  }

  // ── 6. Derive the linked course_ids ───────────────────────────────────
  const { data: cbRows } = await serviceClient
    .from('course_batches')
    .select('course_id')
    .in('batch_id', batchIds);

  const courseIds = [...new Set((cbRows ?? []).map((r: any) => r.course_id))] as string[];
  if (courseIds.length === 0) {
    return { allowed: false, message: LIVE_BLOCKED_MESSAGE };
  }

  // ── 7. Entitlement — can_student_access_live_course per course (ANY) ──
  //      Invoked through the anon client with the caller's JWT so the
  //      helper's auth.uid()/get_my_student_id() resolve to THIS student.
  for (const courseId of courseIds) {
    try {
      const { data: allowed, error } = await anonClient.rpc(
        'can_student_access_live_course',
        { p_course_id: courseId },
      );

      if (error) {
        structuredLog('ENTITLEMENT_RPC_ERROR', {
          courseId,
          error: error.message,
        });
        continue; // fail closed for this course
      }

      if (allowed === true) {
        structuredLog('ENTITLEMENT_GRANTED', { courseId });
        return { allowed: true };
      }

      structuredLog('ENTITLEMENT_DENIED_COURSE', { courseId });
    } catch (rpcErr) {
      structuredLog('ENTITLEMENT_RPC_EXCEPTION', {
        courseId,
        error: rpcErr instanceof Error ? rpcErr.message : 'Unknown RPC error',
      });
    }
  }

  return { allowed: false, message: LIVE_BLOCKED_MESSAGE };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // ── Method check ────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  structuredLog('TOKEN_REQUEST_RECEIVED', { method: req.method });

  try {
    // ══════════════════════════════════════════════════════════════════
    // Step 1: Authenticate the caller via Supabase Auth
    // ══════════════════════════════════════════════════════════════════
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return errorResponse(
        'Server configuration error: missing Supabase credentials.',
        500,
      );
    }

    // Anon client forwarding the caller's JWT — used for getUser() and for
    // the can_student_access_live_course RPC (which needs auth.uid()).
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    let userId: string;
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData?.user) {
        structuredLog('AUTH_FAILED', {
          error: userError?.message ?? 'No user returned from getUser()',
        });
        return errorResponse('Invalid or expired authentication token.', 401);
      }

      userId = userData.user.id;

      structuredLog('AUTH_SUCCESS', {
        userId,
        email: userData.user.email ?? 'unknown',
      });
    } catch (err) {
      structuredLog('AUTH_EXCEPTION', {
        error: err instanceof Error ? err.message : 'Unknown error during authentication',
      });
      return errorResponse('Authentication verification failed.', 401);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 2: Parse and validate the request body (Phase 11J.2 contract)
    // ══════════════════════════════════════════════════════════════════
    // Only classId + participantName are accepted. Legacy roomName / role
    // fields are ignored (role is re-derived from profiles server-side).
    let body: TokenRequestBody;
    try {
      const raw = await req.json() as Record<string, unknown>;

      if (typeof raw.classId !== 'string' || !isValidUuid(raw.classId)) {
        return errorResponse(
          'Missing or invalid field: classId (UUID string required).',
          400,
        );
      }
      if (typeof raw.participantName !== 'string' || raw.participantName.trim() === '') {
        return errorResponse(
          'Missing or invalid field: participantName (non-empty string required).',
          400,
        );
      }

      body = {
        classId: raw.classId,
        participantName: raw.participantName,
      };

      // Migration notice: legacy clients may still send roomName/role — they
      // are deliberately ignored, never trusted.
      if (raw.roomName !== undefined || raw.role !== undefined) {
        structuredLog('LEGACY_FIELDS_IGNORED', {
          hadRoomName: raw.roomName !== undefined,
          hadRole: raw.role !== undefined,
        });
      }

      structuredLog('REQUEST_VALIDATED', {
        classId: body.classId,
        participantName: body.participantName,
      });
    } catch (err) {
      return errorResponse('Invalid request body. Expected valid JSON.', 400);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Server-authoritative resolution (service role)
    // ══════════════════════════════════════════════════════════════════
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // 3a. Authoritative role from profiles — never from the request body.
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('role')
      .eq('profile_id', userId)
      .maybeSingle();

    const role = (profile?.role as string | undefined) ?? '';

    structuredLog('ROLE_RESOLVED', { role });

    // 3b. Resolve the class from the database by classId.
    const { data: liveClass, error: classError } = await serviceClient
      .from('live_classes')
      .select('class_id, institute_id, teacher_id, status, room_name')
      .eq('class_id', body.classId)
      .maybeSingle();

    if (classError || !liveClass) {
      structuredLog('CLASS_NOT_FOUND', { classId: body.classId });
      return errorResponse('Live class not found.', 404);
    }

    structuredLog('CLASS_RESOLVED', {
      classId: liveClass.class_id,
      status: liveClass.status,
      hasRoomName: liveClass.room_name !== null,
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Role-based authorization
    // ══════════════════════════════════════════════════════════════════
    let canPublish = false;

    if (role === 'admin') {
      // Admin: full bypass.
      canPublish = true;
      structuredLog('ADMIN_BYPASS', { classId: liveClass.class_id });
    } else if (role === 'teacher') {
      // Teacher: may only join classes they own.
      const { data: teacher } = await serviceClient
        .from('teacher_details')
        .select('teacher_id')
        .eq('profile_id', userId)
        .maybeSingle();

      if (!teacher || teacher.teacher_id !== liveClass.teacher_id) {
        structuredLog('TEACHER_OWNERSHIP_DENIED', {
          classId: liveClass.class_id,
          classTeacherId: liveClass.teacher_id,
        });
        return errorResponse('You do not own this live class.', 403);
      }

      // Phase 1: a teacher may only obtain a token for a class that has
      // actually been started through start_scheduled_live_class() — i.e.
      // status='live' AND room_name persisted. This closes the previous
      // bypass where a teacher could mint a publish token for a
      // scheduled/future/completed/cancelled class via the derived-room edge.
      if (liveClass.status !== 'live' || !liveClass.room_name) {
        structuredLog('TEACHER_CLASS_NOT_STARTED', {
          classId: liveClass.class_id,
          status: liveClass.status,
          roomName: liveClass.room_name,
        });
        return errorResponse('This class has not started yet.', 409);
      }

      canPublish = true;
      structuredLog('TEACHER_OWNERSHIP_GRANTED', { classId: liveClass.class_id });
    } else if (role === 'student') {
      // Student: batch membership AND course-scoped live subscription.
      const decision = await authorizeStudent(
        supabase,
        serviceClient,
        userId,
        liveClass,
      );

      if (!decision.allowed) {
        structuredLog('STUDENT_AUTHORIZATION_DENIED', {
          classId: liveClass.class_id,
          reason: decision.message,
        });
        return errorResponse(
          decision.message ?? LIVE_BLOCKED_MESSAGE,
          403,
        );
      }

      structuredLog('STUDENT_AUTHORIZATION_GRANTED', {
        classId: liveClass.class_id,
      });
    } else {
      return errorResponse('Unauthorized role. Access denied.', 403);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 5: Server-derived room — token must never use a client room.
    // ══════════════════════════════════════════════════════════════════
    let room = liveClass.room_name;

    if (!room) {
      // Admin tooling edge only: an admin may derive the deterministic room
      // before live_classes.room_name is persisted. Teachers can never reach
      // this branch — their branch above requires status='live' and a
      // persisted room_name (set by start_scheduled_live_class). Students
      // never receive a derived room.
      if (role === 'admin') {
        room = buildRoomName(body.classId);
        structuredLog('ROOM_DERIVED_FROM_CLASS_ID', {
          classId: body.classId,
          room,
        });
      } else {
        return errorResponse('This class has not started yet.', 409);
      }
    }

    structuredLog('ROOM_RESOLVED', {
      room,
      source: liveClass.room_name ? 'database' : 'derived',
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 6: Generate the LiveKit Access Token
    // ══════════════════════════════════════════════════════════════════
    const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
    const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    const livekitUrl = Deno.env.get('LIVEKIT_URL');

    if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
      return errorResponse(
        'Server configuration error: missing LiveKit credentials. ' +
        'Ensure LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL are set.',
        500,
      );
    }

    try {
      // identity = user.id (profile_id UUID) so the livekit-webhook can
      // resolve participants to students for attendance.
      const token = new AccessToken(livekitApiKey, livekitApiSecret, {
        identity: userId,
        name: body.participantName,
      });

      token.addGrant({
        roomJoin: true,
        room,                      // ← server-derived (never client-supplied)
        canPublish,                // ← admin / teacher-owner only
        canSubscribe: true,
      });

      const jwt = await token.toJwt();

      structuredLog('TOKEN_GENERATED', {
        identity: userId,
        name: body.participantName,
        role,
        room,
        canPublish,
        tokenLength: jwt.length,
      });

      return jsonResponse({
        token: jwt,
        url: livekitUrl,
      });
    } catch (err) {
      structuredLog('TOKEN_GENERATION_FAILED', {
        error: err instanceof Error ? err.message : 'Unknown error during token generation',
        stack: err instanceof Error ? err.stack : undefined,
      });
      return errorResponse('Failed to generate LiveKit token. Please try again.', 500);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('UNEXPECTED_ERROR', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('An unexpected error occurred.', 500);
  }
});
