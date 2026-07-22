/**
 * LiveKit Token Service
 *
 * Fetches a LiveKit JWT from the `livekit-token` Supabase Edge Function.
 *
 * The Edge Function validates the caller's Supabase auth JWT, then
 * generates a signed LiveKit Access Token with role-based permissions.
 *
 * @module lib/livekit/tokenService
 */

import { supabase } from '@/config/supabase';
import { getTokenExpirySummary } from '@/utils/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TokenRequest {
  /** Name of the LiveKit room to join. */
  roomName: string;
  /** Display name for the participant. */
  participantName: string;
  /** Role determines publish/subscribe permissions. */
  role: 'teacher' | 'student' | 'admin';
}

export interface TokenResponse {
  /** LiveKit JWT for authentication. */
  token: string;
  /** WebSocket URL of the LiveKit server. */
  url: string;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Requests a LiveKit join token from the Supabase Edge Function.
 *
 * @param request - Room name, participant name, and role.
 * @returns Token and LiveKit server URL.
 * @throws If the Edge Function call fails or returns an invalid response.
 */
export async function getLiveKitToken(
  request: TokenRequest,
): Promise<TokenResponse> {
  console.log('[LiveKit Debug] ===== getLiveKitToken CALLED =====');
  console.log('[LiveKit Debug] Request params:', {
    roomName: request.roomName,
    participantName: request.participantName,
    role: request.role,
  });

  // ── [LiveKit Debug] Check current auth session before Edge Function call ──
  console.log('[LiveKit Debug] Checking current auth session BEFORE invoke...');

  let sessionChecked = false;
  let wasRefreshed = false;

  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      console.error('[LiveKit Debug] getSession() before invoke FAILED:', {
        errorName: sessionError.name,
        errorMessage: sessionError.message,
      });
    } else if (!sessionData.session) {
      console.warn('[LiveKit Debug] No active session found before invoke! User may not be logged in.');
    } else {
      const session = sessionData.session;
      sessionChecked = true;

      console.log('[LiveKit Debug] Session found before invoke:', {
        userId: session.user.id,
        email: session.user.email,
        hasAccessToken: !!session.access_token,
        tokenExpirySummary: getTokenExpirySummary(session.access_token),
        hasRefreshToken: !!session.refresh_token,
        createdAt: session.user.created_at,
      });

      // If the token is expired or about to expire (within 60s), refresh it
      const claims = (() => {
        try {
          if (!session.access_token) return null;
          const parts = session.access_token.split('.');
          if (parts.length !== 3) return null;
          const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
          return JSON.parse(atob(padded));
        } catch {
          return null;
        }
      })();

      const exp = (claims as any)?.exp as number | undefined;
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresSoon = exp ? (exp - nowSec) < 60 : false;

      if (expiresSoon) {
        console.log('[LiveKit Debug] Token expires soon (or is expired). Attempting refresh BEFORE invoke...');
        wasRefreshed = true;
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();

        if (refreshError) {
          console.error('[LiveKit Debug] Pre-invoke refreshSession FAILED:', {
            errorName: refreshError.name,
            errorMessage: refreshError.message,
          });
        } else if (refreshData.session) {
          console.log('[LiveKit Debug] Pre-invoke refreshSession SUCCEEDED:', {
            userId: refreshData.session.user.id,
            newTokenExpiry: getTokenExpirySummary(refreshData.session.access_token),
          });
        } else {
          console.warn('[LiveKit Debug] Pre-invoke refreshSession returned no session.');
        }
      }
    }
  } catch (err) {
    console.error('[LiveKit Debug] Exception during pre-invoke session check:', err);
  }

  // ── [LiveKit Debug] Summary before invoke ──
  console.log('[LiveKit Debug] PRE-INVOKE SUMMARY:', {
    sessionChecked,
    wasRefreshed,
    request: { roomName: request.roomName, participantName: request.participantName, role: request.role },
  });

  // ── [LiveKit Debug] Detailed session diagnostics just before invoke ──
  if (sessionChecked) {
    // Re-fetch the latest session to get the most current token
    const { data: freshSessionData } = await supabase.auth.getSession();
    const freshSession = freshSessionData?.session;
    if (freshSession) {
      const claims = (() => {
        try {
          if (!freshSession.access_token) return null;
          const parts = freshSession.access_token.split('.');
          if (parts.length !== 3) return null;
          const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
          return JSON.parse(atob(padded));
        } catch { return null; }
      })();
      const nowDiag = new Date().toISOString();
      console.log(`[${nowDiag}] [LK-DIAG-WEB] INVOKE SESSION DIAGNOSTICS:`);
      console.log(`[${nowDiag}] [LK-DIAG-WEB]   userId               =`, freshSession.user.id);
      console.log(`[${nowDiag}] [LK-DIAG-WEB]   email                =`, freshSession.user.email);
      console.log(`[${nowDiag}] [LK-DIAG-WEB]   expires_at           =`, claims?.exp ? new Date((claims.exp as number) * 1000).toISOString() : 'unknown');
      console.log(`[${nowDiag}] [LK-DIAG-WEB]   hasAccessToken       =`, !!freshSession.access_token);
      console.log(`[${nowDiag}] [LK-DIAG-WEB]   access token length  =`, freshSession.access_token?.length ?? 0);
      console.log(`[${nowDiag}] [LK-DIAG-WEB]   access token (1st 20)=`, freshSession.access_token ? freshSession.access_token.substring(0, 20) + '...' : 'N/A');
    }
    // Log the Supabase URL
    const supabaseUrl = (supabase as any)?.supabaseUrl ||
                        (supabase as any)?.functions?.url ||
                        (typeof (supabase as any)?.rest?.url === 'string' ? (supabase as any).rest.url : 'unknown');
    console.log('[LiveKit Debug] SUPABASE URL:', supabaseUrl);
    console.log('[LiveKit Debug] EXACT INVOKE ARGUMENTS:', {
      functionName: 'livekit-token',
      body: JSON.stringify(request),
    });
  } else {
    console.warn('[LiveKit Debug] Session was NOT checked before invoke (sessionChecked=false)');
  }

  // ── [LK-DIAG-WEB] Also check getUser() for additional diagnostics ──
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const nowUser = new Date().toISOString();
    console.log(`[${nowUser}] [LK-DIAG-WEB] getUser() BEFORE invoke:`);
    if (userError) {
      console.error(`[${nowUser}] [LK-DIAG-WEB]   getUser error:`, JSON.stringify(userError, Object.getOwnPropertyNames(userError)));
    }
    if (userData?.user) {
      console.log(`[${nowUser}] [LK-DIAG-WEB]   user exists = true`);
      console.log(`[${nowUser}] [LK-DIAG-WEB]   user.id     =`, userData.user.id);
      console.log(`[${nowUser}] [LK-DIAG-WEB]   email       =`, userData.user.email);
    } else {
      console.log(`[${nowUser}] [LK-DIAG-WEB]   user exists = false (user is null)`);
    }
  } catch (getUserErr) {
    console.error(`[${new Date().toISOString()}] [LK-DIAG-WEB] getUser() THREW:`, getUserErr);
  }

  // ── Edge Function Invocation ──
  console.log('[LiveKit Debug] INVOKE START — calling supabase.functions.invoke("livekit-token")...');
  const invokeStartTime = Date.now();

  // ── [LK-DIAG-WEB] Wrap invoke in try/catch ──
  let invokeResult: { data: unknown; error: unknown } | null = null;
  try {
    invokeResult = await supabase.functions.invoke('livekit-token', {
      body: request,
    });
  } catch (invokeException: unknown) {
    const excDuration = Date.now() - invokeStartTime;
    const now = new Date().toISOString();
    console.error(`[${now}] [LK-DIAG-WEB] invoke() EXCEPTION (threw before returning, duration: ${excDuration}ms):`);
    console.error(`[${now}] [LK-DIAG-WEB]   name       =`, (invokeException as Error)?.name ?? 'N/A');
    console.error(`[${now}] [LK-DIAG-WEB]   message    =`, (invokeException as Error)?.message ?? 'N/A');
    console.error(`[${now}] [LK-DIAG-WEB]   stack      =`, (invokeException as Error)?.stack ?? 'N/A');
    console.error(`[${now}] [LK-DIAG-WEB]   complete   =`, invokeException);
    throw invokeException;
  }

  const { data, error } = invokeResult;
  const invokeDuration = Date.now() - invokeStartTime;

  if (error) {
    console.error('[LiveKit Debug] INVOKE FAILED (duration: ' + invokeDuration + 'ms)');
    console.error('[LiveKit Debug] Error object (full):', JSON.stringify({
      name: error.name,
      message: error.message,
      status: (error as any)?.status,
      context: (error as any)?.context,
    }, null, 2));
    console.error('[LiveKit Debug] Error toString():', error.toString());
    console.error('[LiveKit Debug] Error keys:', Object.keys(error));
    // Log every enumerable property on the error
    for (const key of Object.keys(error)) {
      const val = (error as any)[key];
      const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
      console.error('[LiveKit Debug] Error.' + key + ':', valStr);
    }
    // Log the full FunctionsHttpError object
    if (typeof error === 'object' && error !== null) {
      try {
        console.error('[LiveKit Debug] Full error JSON:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      } catch (e) {
        console.error('[LiveKit Debug] Could not serialize full error:', e);
      }
    }

    // ── [LK-DIAG-WEB] Log FunctionsHttpError properties individually ──
    const now2 = new Date().toISOString();
    console.error(`[${now2}] [LK-DIAG-WEB] FunctionsHttpError individual properties:`);
    const errRecord = error as Record<string, unknown>;
    const errProps = ['error', 'status', 'context', 'response', 'message', 'name'];
    for (const key of errProps) {
      const val = errRecord[key];
      const valStr = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? 'N/A');
      console.error(`[${now2}] [LK-DIAG-WEB]   ${key} = ${valStr}`);
    }

    throw new Error(`Failed to fetch LiveKit token: ${error.message}`);
  }

  console.log('[LiveKit Debug] INVOKE SUCCEEDED (duration: ' + invokeDuration + 'ms)');
  console.log('[LiveKit Debug] Response data keys:', Object.keys(data as object || {}));

  const response = data as TokenResponse;

  if (!response?.token || !response?.url) {
    console.error('[LiveKit Debug] INVALID RESPONSE — missing token or url:', JSON.stringify(response));
    throw new Error('LiveKit token service returned an invalid response.');
  }

  console.log('[LiveKit Debug] Token received successfully:', {
    url: response.url,
    tokenLength: response.token.length,
    tokenFirst20Chars: response.token.substring(0, 20) + '...',
  });

  console.log('[LiveKit Debug] ===== getLiveKitToken COMPLETE =====');
  return response;
}
