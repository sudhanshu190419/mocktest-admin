/**
 * Supabase Edge Function — livekit-token
 *
 * Generates an authoritative, server-verified LiveKit Access Token so an
 * authenticated student, teacher, or admin can join a LiveKit room.
 *
 * This function MUST be called with a valid Supabase JWT (verify_jwt = true).
 *
 * Request (POST /):
 *   {
 *     "classId": "uuid",             // Preferred
 *     "roomName": "room-uuid",        // Backward compatibility
 *     "participantName": "John Doe"
 *   }
 *
 * Response (200):
 *   {
 *     "token": "eyJhbGciOiJIUzI1NiJ9...",
 *     "url": "wss://my-project.livekit.cloud"
 *   }
 *
 * Errors:
 *   401 — Unauthenticated (handled automatically by Supabase Edge Runtime)
 *   400 — Missing or invalid request fields
 *   403 — Unauthorized (student not enrolled, wrong teacher, cross-institute, cancelled)
 *   404 — Live class not found
 *   500 — Missing environment variables or LiveKit SDK failure
 *
 * @module edge-function
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from '@supabase/supabase-js';
import { AccessToken } from 'livekit-server-sdk';
import {
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET,
  LIVEKIT_URL,
} from './config.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Shape of the incoming token request. */
interface TokenRequestBody {
  classId?: string;
  roomName?: string;
  participantName?: string;
  role?: string; // Client role is ignored; derived server-side
}

/** Shape of the successful token response. */
interface TokenResponseBody {
  token: string;
  url: string;
}

/** Structured log context used throughout the function. */
interface LogContext {
  requestId: string;
  userId?: string;
  classId?: string;
  roomName?: string;
  role?: string;
  error?: string;
}

/** Response shape from authorize_live_class_access RPC. */
interface AuthRpcResponse {
  authorized: boolean;
  classId?: string;
  roomName?: string;
  role?: 'teacher' | 'student' | 'admin';
  canPublish?: boolean;
  title?: string;
  status?: string;
  error?: string;
  code?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function logStructured(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: LogContext,
  extra?: Record<string, unknown>,
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'livekit-token',
    message,
    ...context,
    ...extra,
  };
  const formatted = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(formatted);
      break;
    case 'warn':
      console.warn(formatted);
      break;
    default:
      console.log(formatted);
  }
}

// ─── CORS Headers ────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function checkEnv(): string | null {
  if (!LIVEKIT_API_KEY) return 'LIVEKIT_API_KEY is not set.';
  if (!LIVEKIT_API_SECRET) return 'LIVEKIT_API_SECRET is not set.';
  if (!LIVEKIT_URL) return 'LIVEKIT_URL is not set.';
  return null;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  const requestId = generateRequestId();

  // ── CORS preflight ─────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Only POST requests are accepted' }, 405);
  }

  // ── Check environment variables ────────────────────────────────
  const envError = checkEnv();
  if (envError) {
    logStructured('error', 'Environment configuration error', { requestId }, { detail: envError });
    return jsonResponse({ error: 'Server configuration error. Contact support.' }, 500);
  }

  // ── Verify authenticated user via Supabase Auth ────────────────
  const authHeader = req.headers.get('authorization');
  if (!authHeader) {
    logStructured('warn', 'Unauthenticated request: missing Authorization header', { requestId });
    return jsonResponse({ error: 'Unauthenticated. A valid Supabase JWT is required.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? supabaseAnonKey;

  const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await supabaseUserClient.auth.getUser();

  if (authError || !user) {
    logStructured('warn', 'Unauthenticated request: invalid token', { requestId }, {
      error: authError?.message ?? 'User is null',
    });
    return jsonResponse({ error: 'Unauthenticated. A valid Supabase JWT is required.' }, 401);
  }

  // ── Parse request body ─────────────────────────────────────────
  let body: TokenRequestBody;
  try {
    body = await req.json() as TokenRequestBody;
  } catch {
    logStructured('error', 'Failed to parse request body as JSON', { requestId });
    return jsonResponse({ error: 'Invalid JSON in request body' }, 400);
  }

  const classIdParam = body.classId?.trim() || undefined;
  const roomNameParam = body.roomName?.trim() || undefined;
  const participantName = body.participantName?.trim() || user.user_metadata?.full_name || user.email || 'Participant';

  if (!classIdParam && !roomNameParam) {
    return jsonResponse({ error: 'Missing classId or roomName in request body.' }, 400);
  }

  // ── Authorize user via SECURITY DEFINER database RPC ──────────
  // Use service role client to execute the authorization helper cleanly
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  const { data: authData, error: rpcError } = await supabaseAdmin.rpc(
    'authorize_live_class_access',
    {
      p_user_id: user.id,
      p_class_id: classIdParam || null,
      p_room_name: roomNameParam || null,
    },
  );

  if (rpcError) {
    logStructured('error', 'Authorization RPC error', { requestId, userId: user.id }, {
      rpcError: rpcError.message,
    });
    return jsonResponse({ error: 'Failed to verify class authorization.' }, 500);
  }

  const authResult = authData as AuthRpcResponse;

  if (!authResult || !authResult.authorized) {
    const errorMsg = authResult?.error || 'Access denied: You are not authorized to join this live class.';
    const statusCode = authResult?.code === 'CLASS_NOT_FOUND' ? 404 : 403;
    logStructured('warn', 'Authorization denied', {
      requestId,
      userId: user.id,
      classId: classIdParam,
      roomName: roomNameParam,
    }, {
      reason: errorMsg,
      code: authResult?.code,
    });
    return jsonResponse({ error: errorMsg, code: authResult?.code }, statusCode);
  }

  const resolvedRoomName = authResult.roomName!;
  const canPublish = authResult.canPublish === true;
  const resolvedRole = authResult.role || 'student';

  const logContext: LogContext = {
    requestId,
    userId: user.id,
    classId: authResult.classId,
    roomName: resolvedRoomName,
    role: resolvedRole,
  };

  logStructured('info', 'Authorized LiveKit token request', logContext, {
    canPublish,
    title: authResult.title,
  });

  // ── Generate LiveKit Access Token ──────────────────────────────
  try {
    const token = new AccessToken(LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!, {
      identity: user.id,
      name: participantName,
    });

    token.addGrant({
      roomJoin: true,
      room: resolvedRoomName,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });

    const jwt = await token.toJwt();

    const responseBody: TokenResponseBody = {
      token: jwt,
      url: LIVEKIT_URL!,
    };

    logStructured('info', 'LiveKit token generated successfully', logContext, {
      tokenLength: jwt.length,
      canPublish,
    });

    return jsonResponse(responseBody, 200);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStructured('error', 'LiveKit token generation failed', logContext, { error: errorMessage });
    return jsonResponse({ error: 'Failed to generate LiveKit token.' }, 500);
  }
});
