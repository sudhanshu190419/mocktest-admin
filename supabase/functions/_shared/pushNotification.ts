// ============================================================================
// Shared Helper: Push Notification Service
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Reusable push notification sender using the Firebase Cloud Messaging
// HTTP v1 API. Designed to be imported by any Edge Function that needs
// to deliver push notifications to a user's active devices.
//
// Authentication:
//   Uses a Firebase Service Account (stored in FCM_SERVICE_ACCOUNT_JSON)
//   to obtain OAuth 2.0 access tokens via the JWT Bearer flow.
//   The service account JSON is read from Deno.env at runtime — never
//   hardcoded.
//
// Token lifecycle:
//   • Queries device_tokens WHERE profile_id = ? AND is_active = true
//   • Sends to EVERY active device independently
//   • A failure on one device does NOT stop delivery to others
//   • If Firebase reports an invalid/unregistered token, marks it inactive
//     in device_tokens so it is excluded from future dispatches
//
// Safety:
//   • NEVER throws — always returns a structured PushNotificationResult
//   • All errors are logged via structuredLog
//
// @module _shared/pushNotification
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════════════════════════
// Types — Public
// ═══════════════════════════════════════════════════════════════════════════

/** Parameters for sending a push notification to a user. */
export interface PushNotificationParams {
  /** The target user's profile_id. */
  profileId: string;
  /** Notification title (displayed prominently on the device). */
  title: string;
  /** Notification body text. */
  body: string;
  /**
   * Optional key-value data payload sent alongside the notification.
   * All values MUST be strings (FCM v1 requirement).
   * Used for deep-linking, navigation, or custom handling in the app.
   */
  data?: Record<string, string>;
}

/** Structured result returned for every invocation — never thrown. */
export interface PushNotificationResult {
  /** Total active devices found for this user. */
  totalDevices: number;
  /** Number of devices the notification was successfully delivered to. */
  successful: number;
  /** Number of devices where delivery failed (including invalid tokens). */
  failed: number;
  /**
   * FCM tokens that Firebase reported as invalid or unregistered.
   * These have been marked is_active = false in device_tokens.
   */
  invalidTokens: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Types — Internal
// ═══════════════════════════════════════════════════════════════════════════

/** Schema of the Firebase service account JSON. */
interface FirebaseServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

/** A row from the device_tokens table for push dispatch. */
interface DeviceTokenRow {
  token_id: string;
  fcm_token: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** FCM v1 API endpoint template. Replace {projectId} with the Firebase project ID. */
const FCM_V1_ENDPOINT = 'https://fcm.googleapis.com/v1/projects/{projectId}/messages:send';

/** Google OAuth 2.0 token exchange endpoint. */
const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** OAuth 2.0 scope required for Firebase Cloud Messaging. */
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/**
 * Access token lifetime in seconds.
 * Google OAuth 2.0 tokens are valid for 3600 seconds (1 hour).
 * We request the full hour for each token.
 */
const TOKEN_LIFETIME_SECONDS = 3600;

// ═══════════════════════════════════════════════════════════════════════════
// Structured Logging
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Emit a structured log entry as a single-line JSON string.
 * Follows the same convention used by all existing Edge Functions in
 * this project (see complete-course-purchase, razorpay-webhook, etc.).
 *
 * @param event  A SCREAMING_SNAKE_CASE event name for log filtering.
 * @param data   Arbitrary key-value pairs to include in the log entry.
 */
function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'push-notification',
      event,
      ...data,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// JWT & OAuth 2.0 Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Base64url-encode a string or Uint8Array.
 *
 * Base64url is the standard encoding for JWT (RFC 7515):
 *   - Replaces '+' with '-'
 *   - Replaces '/' with '_'
 *   - Strips trailing '=' padding
 *
 * @param input  A plain string or Uint8Array of bytes.
 * @returns The base64url-encoded string.
 */
function base64UrlEncode(input: string | Uint8Array): string {
  let bytes: Uint8Array;

  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = input;
  }

  // Convert bytes to a binary string, then base64 encode
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Sign data with RSA-SHA256 (RS256) using the Web Crypto API.
 *
 * The private key is expected in PEM format (PKCS#8), exactly as
 * provided by the Firebase service account JSON (private_key field).
 *
 * @param data           The UTF-8 string to sign (the JWT signing input).
 * @param privateKeyPem  The PEM-encoded RSA private key (PKCS#8).
 * @returns The raw RS256 signature bytes as a Uint8Array.
 */
async function signRsaSha256(
  data: string,
  privateKeyPem: string,
): Promise<Uint8Array> {
  // Strip PEM header/footer and whitespace to get raw base64
  const pemContents = privateKeyPem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  // Decode base64 to DER bytes
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  // Import the private key for RSASSA-PKCS1-v1_5 signing
  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Sign the data
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(data),
  );

  return new Uint8Array(signature);
}

/**
 * Obtain a Google OAuth 2.0 access token using a service account JWT.
 *
 * Implements the JWT Bearer Token flow (RFC 7523) to exchange a
 * self-signed JWT for an OAuth 2.0 access token.
 *
 * The JWT assertion contains:
 *   - iss:  The service account's client_email
 *   - scope: https://www.googleapis.com/auth/firebase.messaging
 *   - aud:  https://oauth2.googleapis.com/token
 *   - exp:  Current time + 1 hour
 *   - iat:  Current time
 *
 * @param serviceAccount  The parsed Firebase service account JSON.
 * @returns A promise resolving to the OAuth 2.0 access token string.
 * @throws If the OAuth token endpoint returns an error.
 */
async function getAccessToken(
  serviceAccount: FirebaseServiceAccount,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // ── Build JWT assertion ──────────────────────────────────────────────
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: FCM_SCOPE,
    aud: OAUTH_TOKEN_ENDPOINT,
    exp: now + TOKEN_LIFETIME_SECONDS,
    iat: now,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Sign with RS256
  const signatureBytes = await signRsaSha256(
    signingInput,
    serviceAccount.private_key,
  );
  const signatureB64 = base64UrlEncode(signatureBytes);

  const jwt = `${signingInput}.${signatureB64}`;

  // ── Exchange JWT for access token ────────────────────────────────────
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt,
  });

  const response = await fetch(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    let message: string;
    try {
      const parsed = JSON.parse(errorBody) as Record<string, unknown>;
      message =
        (parsed.error_description as string) ??
        (parsed.error as string) ??
        `HTTP ${response.status}`;
    } catch {
      message = `HTTP ${response.status}: ${errorBody.slice(0, 200)}`;
    }
    throw new Error(`OAuth token exchange failed: ${message}`);
  }

  const tokenData = (await response.json()) as { access_token: string };
  return tokenData.access_token;
}

// ═══════════════════════════════════════════════════════════════════════════
// FCM v1 Send
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a push notification to a single device via FCM HTTP v1 API.
 *
 * @returns An object indicating success and whether the token is invalid.
 */
async function sendToDevice(
  accessToken: string,
  projectId: string,
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<{ success: boolean; invalidToken: boolean }> {
  // ── Build the FCM v1 message ─────────────────────────────────────────
  const message: Record<string, unknown> = {
    token: fcmToken,
    notification: {
      title,
      body,
    },
  };

  // Attach data payload if provided (FCM v1 requires all values to be strings)
  if (data && Object.keys(data).length > 0) {
    message.data = data;
  }

  const url = FCM_V1_ENDPOINT.replace('{projectId}', projectId);
  const fcmTokenPrefix = fcmToken.slice(0, 20);

  // ── Log the outgoing request ─────────────────────────────────────────
  structuredLog('FCM_REQUEST_START', {
    fcmTokenPrefix,
    requestUrl: url,
    projectId,
    notificationTitle: title,
    notificationBody: body,
    dataKeys: data ? Object.keys(data) : [],
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; UTF-8',
    },
    body: JSON.stringify({ message }),
  });

  // ── Read response body (once, as text, to avoid stream exhaustion) ───
  let responseBody = '';
  try {
    responseBody = await response.text();
  } catch {
    responseBody = 'Unable to read response body';
  }

  // ── Parse error details if response is not OK ────────────────────────
  let errorStatus = '';
  let errorMessage = '';

  if (!response.ok) {
    try {
      const errorJson = JSON.parse(responseBody) as {
        error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
      };
      const details = errorJson?.error?.details?.[0];
      errorStatus = details?.errorCode ?? errorJson?.error?.status ?? '';
      errorMessage = errorJson?.error?.message ?? '';
    } catch {
      // Response body is not valid JSON — use HTTP status
    }
  }

  // ── Log the response ─────────────────────────────────────────────────
  structuredLog('FCM_RESPONSE', {
    fcmTokenPrefix,
    httpStatus: response.status,
    ok: response.ok,
    errorStatus: response.ok ? undefined : errorStatus,
    errorMessage: response.ok ? undefined : errorMessage,
    responseBodyTruncated: responseBody.slice(0, 500),
  });

  // ── Success ──────────────────────────────────────────────────────────
  if (response.ok) {
    return { success: true, invalidToken: false };
  }

  // ── Determine if the token is invalid and should be deactivated. ─────
  //
  // FCM error codes that mean the token is permanently invalid:
  //   UNREGISTERED     — The token was removed from Firebase (app uninstalled,
  //                      token revoked, etc.). HTTP 404.
  //   INVALID_ARGUMENT — The token is malformed or not a valid FCM token.
  //                      HTTP 400.
  //   THIRD_PARTY_AUTH_ERROR — The token was invalidated by Firebase Auth.
  const isInvalid =
    response.status === 404 ||
    errorStatus === 'UNREGISTERED' ||
    errorStatus === 'INVALID_ARGUMENT' ||
    errorStatus === 'THIRD_PARTY_AUTH_ERROR' ||
    errorMessage.toLowerCase().includes('registration token');

  return { success: false, invalidToken: isInvalid };
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a push notification to all active devices belonging to a user.
 *
 * This is the single entry point for push notification delivery. It:
 *   1. Queries device_tokens for the user's active devices
 *   2. Obtains an OAuth 2.0 access token from the Firebase service account
 *   3. Sends the notification to every active device via FCM v1 API
 *   4. Marks invalid/unregistered tokens as inactive in the database
 *   5. Returns a structured result summary
 *
 * Usage:
 * ```ts
 * import { sendPushNotification } from '../_shared/pushNotification.ts';
 * import { createClient } from 'jsr:@supabase/supabase-js@2';
 *
 * const supabase = createClient(url, serviceRoleKey);
 * const result = await sendPushNotification(supabase, {
 *   profileId: 'user-uuid',
 *   title: 'New Course Available',
 *   body: 'Check out the new Physics course!',
 *   data: { screen: 'course', courseId: 'abc-123' },
 * });
 *
 * console.log(result); // { totalDevices, successful, failed, invalidTokens }
 * ```
 *
 * NEVER throws — always returns a PushNotificationResult.
 *
 * @param supabase  An authenticated Supabase client (service_role recommended
 *                  for bypassing RLS when deactivating tokens).
 * @param params    The notification parameters.
 * @returns A structured summary of the delivery attempt.
 */
export async function sendPushNotification(
  supabase: ReturnType<typeof createClient>,
  params: PushNotificationParams,
): Promise<PushNotificationResult> {
  const { profileId, title, body, data } = params;

  // ── Log the start of the push operation ──────────────────────────────
  structuredLog('PUSH_SEND_START', {
    profileId,
    title,
    bodyLength: body.length,
    hasData: data != null && Object.keys(data).length > 0,
  });

  // ── Initialise the result with zeros ─────────────────────────────────
  const result: PushNotificationResult = {
    totalDevices: 0,
    successful: 0,
    failed: 0,
    invalidTokens: [],
  };

  try {
    // ══════════════════════════════════════════════════════════════════
    // Step 1: Query active device tokens for this user
    // ══════════════════════════════════════════════════════════════════
    const { data: tokens, error: queryError } = await supabase
      .from('device_tokens')
      .select('token_id, fcm_token, platform')
      .eq('profile_id', profileId)
      .eq('is_active', true);

    if (queryError) {
      structuredLog('PUSH_FAILED', {
        profileId,
        error: queryError.message,
        details: (queryError as { details?: unknown })?.details ?? null,
        hint: (queryError as { hint?: unknown })?.hint ?? null,
      });
      // Return zeros — no devices could be queried
      return result;
    }

    // No active devices found — nothing to send
    if (!tokens || tokens.length === 0) {
      structuredLog('DEVICE_TOKENS_FOUND', { profileId, count: 0 });
      return result;
    }

    result.totalDevices = tokens.length;
    structuredLog('DEVICE_TOKENS_FOUND', {
      profileId,
      count: tokens.length,
    });

    // ── Log per-token details for debugging ──────────────────────────
    for (const token of tokens) {
      structuredLog('DEVICE_TOKEN_DETAIL', {
        profileId,
        tokenId: token.token_id,
        platform: token.platform,
        isActive: true,
        fcmTokenPrefix: token.fcm_token.slice(0, 20),
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 2: Load Firebase service account from environment
    // ══════════════════════════════════════════════════════════════════
    const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');

    if (!serviceAccountJson) {
      structuredLog('PUSH_FAILED', {
        profileId,
        error: 'FCM_SERVICE_ACCOUNT_JSON environment secret is not configured',
        hint: 'Set the FCM_SERVICE_ACCOUNT_JSON secret with the full Firebase service account JSON.',
      });
      result.failed = tokens.length;
      return result;
    }

    let serviceAccount: FirebaseServiceAccount;
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as FirebaseServiceAccount;
    } catch (parseErr) {
      structuredLog('PUSH_FAILED', {
        profileId,
        error: 'FCM_SERVICE_ACCOUNT_JSON is not valid JSON',
        message: parseErr instanceof Error ? parseErr.message : 'Parse error',
      });
      result.failed = tokens.length;
      return result;
    }

    if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
      structuredLog('PUSH_FAILED', {
        profileId,
        error: 'FCM_SERVICE_ACCOUNT_JSON is missing required fields',
        hint: 'Ensure project_id, client_email, and private_key are present.',
      });
      result.failed = tokens.length;
      return result;
    }

    const projectId = serviceAccount.project_id;

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Obtain OAuth 2.0 access token
    // ══════════════════════════════════════════════════════════════════
    let accessToken: string;

    structuredLog('FIREBASE_AUTH_START', {
      profileId,
      projectId,
    });

    try {
      accessToken = await getAccessToken(serviceAccount);

      structuredLog('FIREBASE_AUTH_SUCCESS', {
        profileId,
        projectId,
      });
    } catch (err) {
      structuredLog('PUSH_FAILED', {
        profileId,
        error: err instanceof Error ? err.message : 'Failed to obtain OAuth access token',
        stack: err instanceof Error ? err.stack : undefined,
      });
      result.failed = tokens.length;
      return result;
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Send to every active device independently
    // ══════════════════════════════════════════════════════════════════
    const deviceTokens = tokens as DeviceTokenRow[];

    for (const device of deviceTokens) {
      const tokenLogSuffix = device.fcm_token.slice(0, 16) + '...';

      try {
        const sendResult = await sendToDevice(
          accessToken,
          projectId,
          device.fcm_token,
          title,
          body,
          data,
        );

        if (sendResult.success) {
          result.successful++;
          structuredLog('PUSH_SENT', {
            profileId,
            fcmTokenPrefix: tokenLogSuffix,
          });
        } else if (sendResult.invalidToken) {
          // ── Invalid token — mark inactive in database ───────────
          result.invalidTokens.push(device.fcm_token);
          result.failed++;

          const { error: updateError } = await supabase
            .from('device_tokens')
            .update({ is_active: false })
            .eq('token_id', device.token_id);

          if (updateError) {
            structuredLog('TOKEN_MARKED_INACTIVE', {
              profileId,
              fcmTokenPrefix: tokenLogSuffix,
              error: updateError.message,
              status: 'db_update_failed',
            });
          } else {
            structuredLog('TOKEN_MARKED_INACTIVE', {
              profileId,
              fcmTokenPrefix: tokenLogSuffix,
              status: 'marked_inactive',
            });
          }
        } else {
          // ── Transient failure (rate limit, server error, etc.) ──
          // Do NOT mark the token as inactive — the token itself is valid.
          result.failed++;
          structuredLog('PUSH_FAILED', {
            profileId,
            fcmTokenPrefix: tokenLogSuffix,
            error: 'FCM v1 API returned an error',
            hint: 'Token remains active — the failure may be transient.',
          });
        }
      } catch (err) {
        // ── Unexpected error during fetch or processing ───────────
        // Do NOT mark the token as inactive.
        result.failed++;
        structuredLog('PUSH_FAILED', {
          profileId,
          fcmTokenPrefix: tokenLogSuffix,
          error: err instanceof Error ? err.message : 'Unknown error during push delivery',
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 5: Log summary
    // ══════════════════════════════════════════════════════════════════
    structuredLog('PUSH_SUMMARY', {
      profileId,
      totalDevices: result.totalDevices,
      successful: result.successful,
      failed: result.failed,
      invalidTokensCount: result.invalidTokens.length,
    });
  } catch (err) {
    // ── Catastrophic catch-all — NEVER throw ──────────────────────────
    // This is a safety net for unexpected errors in the outer try block.
    structuredLog('PUSH_FAILED', {
      profileId,
      error: err instanceof Error ? err.message : 'Unknown error in sendPushNotification',
      stack: err instanceof Error ? err.stack : undefined,
      context: 'outer_catch_all',
    });
  }

  return result;
}
