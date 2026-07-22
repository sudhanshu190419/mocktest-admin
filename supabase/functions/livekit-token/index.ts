// ============================================================================
// Edge Function: livekit-token
//
// Generates a signed LiveKit Access Token for authentication with a
// LiveKit room. This is the single backend entry point for both teacher
// and student clients (web & mobile) to obtain a LiveKit JWT.
//
// ── Authentication ─────────────────────────────────────────────────────────
// verify_jwt = true  (default behavior, configured in config.toml)
//
// The Supabase Edge Runtime verifies the caller's Supabase JWT before this
// handler runs. We then call supabase.auth.getUser() to resolve the
// authenticated user's UUID (profile_id), which becomes the LiveKit
// participant identity.
//
// ── Identity Resolution (Critical Change) ─────────────────────────────────
// PREVIOUSLY: identity = participantName (display name like "Rahul Sharma")
//   → participant.identity was a human-readable name
//   → Webhook could not resolve to student_details.profile_id (UUID)
//   → Attendance records were never created
//
// NOW:          identity = user.id (authenticated user's UUID)
//               name     = participantName (display name for LiveKit UI)
//   → participant.identity is the profile_id UUID
//   → Webhook resolves: student_details.profile_id == participant.identity
//   → Attendance records are created correctly
//
// ── Request Body ───────────────────────────────────────────────────────────
// {
//   "roomName": "class-abc12345",        // LiveKit room to join
//   "participantName": "Rahul Sharma",    // Display name (shown in UI)
//   "role": "teacher" | "student" | "admin"  // Permission level
// }
//
// ── Response ───────────────────────────────────────────────────────────────
// {
//   "token": "<livekit-jwt>",   // Signed LiveKit Access Token
//   "url": "wss://<project>.livekit.cloud"  // LiveKit WebSocket URL
// }
//
// ── Environment Variables ──────────────────────────────────────────────────
// LIVEKIT_API_KEY       — LiveKit API key (required)
// LIVEKIT_API_SECRET    — LiveKit API secret (required)
// LIVEKIT_URL           — LiveKit WebSocket URL (required)
// SUPABASE_URL          — Auto-injected by Supabase
// SUPABASE_ANON_KEY     — Auto-injected by Supabase
//
// @module edge-functions/livekit-token
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2.8.1';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface TokenRequestBody {
  /** Name of the LiveKit room to join (e.g. "class-abc12345"). */
  roomName: string;
  /** Display name for the participant shown in the LiveKit UI. */
  participantName: string;
  /** Role determines publish/subscribe permissions. */
  role: 'teacher' | 'student' | 'admin';
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

  structuredLog('TOKEN_REQUEST_RECEIVED', {
    method: req.method,
  });

  try {
    // ══════════════════════════════════════════════════════════════════
    // Step 1: Authenticate the caller via Supabase Auth
    // ══════════════════════════════════════════════════════════════════
    //
    // verify_jwt = true is enabled by default in the Supabase Edge Runtime,
    // which rejects unauthenticated requests before this handler runs.
    // However, we still call supabase.auth.getUser() to retrieve the
    // authenticated user's UUID, which becomes the LiveKit identity.
    //
    // The Authorization header is forwarded from the original request to
    // the Supabase client so that getUser() resolves correctly.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
    }

    // Create a Supabase anon client that forwards the caller's auth token.
    // This allows us to call getUser() and retrieve the authenticated user's
    // profile_id (UUID) for use as the LiveKit participant identity.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      return errorResponse('Server configuration error: missing Supabase URL or anon key.', 500);
    }

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

    // Resolve the authenticated user from the JWT.
    // user.id is the profile_id UUID that matches both:
    //   - auth.users.id (Supabase Auth)
    //   - student_details.profile_id (our application schema)
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
    // Step 2: Parse and validate the request body
    // ══════════════════════════════════════════════════════════════════
    let body: TokenRequestBody;
    try {
      const raw = await req.json() as Record<string, unknown>;
      const missingFields: string[] = [];

      if (!raw.roomName || typeof raw.roomName !== 'string') {
        missingFields.push('roomName');
      }
      if (!raw.participantName || typeof raw.participantName !== 'string') {
        missingFields.push('participantName');
      }
      if (!raw.role || !['teacher', 'student', 'admin'].includes(raw.role as string)) {
        missingFields.push('role (must be "teacher", "student", or "admin")');
      }

      if (missingFields.length > 0) {
        return errorResponse(`Missing or invalid fields: ${missingFields.join(', ')}`, 400);
      }

      body = {
        roomName: raw.roomName as string,
        participantName: raw.participantName as string,
        role: raw.role as TokenRequestBody['role'],
      };

      structuredLog('REQUEST_VALIDATED', {
        roomName: body.roomName,
        participantName: body.participantName,
        role: body.role,
      });
    } catch (err) {
      return errorResponse('Invalid request body. Expected valid JSON.', 400);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Generate the LiveKit Access Token
    // ══════════════════════════════════════════════════════════════════
    //
    // ── identity ────────────────────────────────────────────────────────
    //    Set to user.id (the authenticated user's UUID from Supabase Auth).
    //    This matches the profile_id in student_details, allowing the
    //    livekit-webhook to resolve participants to students.
    //
    // ── name ────────────────────────────────────────────────────────────
    //    Set to participantName (the display name sent by the client).
    //    This is what shows up in the LiveKit UI and logs.
    //
    // ── Role Permissions ────────────────────────────────────────────────
    //    teacher / admin → canPublish = true (speak/share screen)
    //    student           → canPublish = false (listen-only)
    //    All roles       → canSubscribe = true (always can listen/watch)
    //    All roles       → roomJoin = true (always can join the room)
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
      // Create the LiveKit AccessToken with the authenticated user's UUID
      // as the identity. The participantName becomes the display name.
      const token = new AccessToken(livekitApiKey, livekitApiSecret, {
        identity: userId,          // ← UUID from auth — this is the critical fix
        name: body.participantName, // ← Display name for the LiveKit UI
      });

      // Set room permissions based on role
      const canPublish = body.role === 'teacher' || body.role === 'admin';

      token.addGrant({
        roomJoin: true,
        room: body.roomName,
        canPublish,
        canSubscribe: true,
      });

      const jwt = await token.toJwt();

      structuredLog('TOKEN_GENERATED', {
        identity: userId,
        name: body.participantName,
        role: body.role,
        roomName: body.roomName,
        canPublish,
        tokenLength: jwt.length,
      });

      // ══════════════════════════════════════════════════════════════════
      // Step 4: Return the token and WebSocket URL
      // ══════════════════════════════════════════════════════════════════
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
