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

/** Default maximum concurrent FCM requests in the worker pool. */
const DEFAULT_CONCURRENCY = 25;

/** Maximum retries for transient FCM errors (429, 5xx). */
const MAX_RETRIES = 2;

/** Base backoff delay in milliseconds. */
const BASE_BACKOFF_MS = 500;

/** Bulk profile query chunk size when querying device_tokens. Reduced to 50 to prevent HTTP 414 URI Too Long. */
const TOKEN_LOOKUP_CHUNK_SIZE = 50;

/** Chunk size for deactivating invalid device tokens. */
const DEACTIVATE_CHUNK_SIZE = 100;

// ═══════════════════════════════════════════════════════════════════════════
// In-Memory OAuth Token Cache
// ═══════════════════════════════════════════════════════════════════════════

interface CachedOAuthToken {
  token: string;
  expiresAt: number; // Unix timestamp in ms
}

let cachedOAuthToken: CachedOAuthToken | null = null;

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

/**
 * Obtain an OAuth 2.0 access token, reusing cached token if valid for > 60s.
 */
async function getCachedAccessToken(
  serviceAccount: FirebaseServiceAccount,
): Promise<string> {
  const now = Date.now();
  if (cachedOAuthToken && now < cachedOAuthToken.expiresAt - 60_000) {
    return cachedOAuthToken.token;
  }

  const token = await getAccessToken(serviceAccount);
  cachedOAuthToken = {
    token,
    expiresAt: now + TOKEN_LIFETIME_SECONDS * 1000,
  };
  return token;
}

/** Helper sleep function for backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// FCM v1 Send
// ═══════════════════════════════════════════════════════════════════════════

interface SendDeviceResult {
  success: boolean;
  invalidToken: boolean;
  isTransient: boolean;
  httpStatus: number;
}

/**
 * Send a push notification to a single device via FCM HTTP v1 API.
 *
 * @returns An object indicating success, whether the token is invalid, and if the error is transient.
 */
async function sendToDevice(
  accessToken: string,
  projectId: string,
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<SendDeviceResult> {
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

  // ── Success ──────────────────────────────────────────────────────────
  if (response.ok) {
    return { success: true, invalidToken: false, isTransient: false, httpStatus: response.status };
  }

  // ── Determine if the token is permanently invalid ────────────────────
  const isInvalid =
    response.status === 404 ||
    errorStatus === 'UNREGISTERED' ||
    errorStatus === 'INVALID_ARGUMENT' ||
    errorStatus === 'THIRD_PARTY_AUTH_ERROR' ||
    errorMessage.toLowerCase().includes('registration token') ||
    errorMessage.toLowerCase().includes('not a valid fcm registration token');

  // ── Determine if error is transient (can be retried with backoff) ─────
  const isTransient =
    response.status === 429 ||
    response.status === 500 ||
    response.status === 502 ||
    response.status === 503 ||
    response.status === 504 ||
    errorStatus === 'RESOURCE_EXHAUSTED' ||
    errorStatus === 'UNAVAILABLE';

  structuredLog('FCM_RESPONSE_ERROR', {
    fcmTokenPrefix,
    httpStatus: response.status,
    errorStatus,
    errorMessage,
    isInvalid,
    isTransient,
  });

  return { success: false, invalidToken: isInvalid, isTransient, httpStatus: response.status };
}

/**
 * Send to device with bounded exponential backoff retry for transient errors.
 */
async function sendToDeviceWithRetry(
  accessToken: string,
  projectId: string,
  fcmToken: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<{ success: boolean; invalidToken: boolean }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await sendToDevice(accessToken, projectId, fcmToken, title, body, data);
      if (res.success) {
        return { success: true, invalidToken: false };
      }

      if (res.invalidToken) {
        // Permanent failure — do NOT retry
        return { success: false, invalidToken: true };
      }

      if (!res.isTransient) {
        // Non-transient non-token error (e.g. 403 Forbidden / invalid project setup)
        return { success: false, invalidToken: false };
      }

      // Transient failure (429, 5xx) — retry if attempts remain
      if (attempt < MAX_RETRIES) {
        const jitter = Math.floor(Math.random() * 200);
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt) + jitter;
        structuredLog('FCM_RETRY_BACKOFF', {
          fcmTokenPrefix: fcmToken.slice(0, 20),
          attempt: attempt + 1,
          delayMs,
        });
        await sleep(delayMs);
      }
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const jitter = Math.floor(Math.random() * 200);
        const delayMs = BASE_BACKOFF_MS * Math.pow(2, attempt) + jitter;
        await sleep(delayMs);
      } else {
        structuredLog('FCM_FETCH_FAILED_PERMANENT', {
          fcmTokenPrefix: fcmToken.slice(0, 20),
          error: err instanceof Error ? err.message : 'Fetch error',
        });
        return { success: false, invalidToken: false };
      }
    }
  }

  return { success: false, invalidToken: false };
}

/**
 * Load and validate Firebase service account JSON from environment.
 */
function loadServiceAccount(): FirebaseServiceAccount | null {
  const serviceAccountJson = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!serviceAccountJson) {
    structuredLog('PUSH_CONFIG_ERROR', {
      error: 'FCM_SERVICE_ACCOUNT_JSON environment secret is not configured',
    });
    return null;
  }

  try {
    const parsed = JSON.parse(serviceAccountJson) as FirebaseServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      structuredLog('PUSH_CONFIG_ERROR', {
        error: 'FCM_SERVICE_ACCOUNT_JSON is missing required fields (project_id, client_email, private_key)',
      });
      return null;
    }
    return parsed;
  } catch (err) {
    structuredLog('PUSH_CONFIG_ERROR', {
      error: 'FCM_SERVICE_ACCOUNT_JSON is not valid JSON',
      message: err instanceof Error ? err.message : 'Parse error',
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — Bulk Push Dispatch
// ═══════════════════════════════════════════════════════════════════════════

export interface BulkPushNotificationParams {
  profileIds: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
  concurrency?: number;
}

export interface BulkPushNotificationResult {
  totalProfiles: number;
  totalDevices: number;
  successful: number;
  failed: number;
  invalidTokens: string[];
}

/**
 * Dispatch push notifications to hundreds or thousands of recipients in bulk.
 *
 * Performance characteristics:
 *   1. Resolves active device tokens for all profileIds in chunks of 500.
 *   2. Caches Google OAuth access token across all devices and recipients.
 *   3. Runs a bounded worker pool (default 25 concurrent requests) to prevent
 *      socket exhaustion or FCM rate limiting.
 *   4. Retries transient failures (429/5xx) with exponential backoff & jitter.
 *   5. Batch deactivates invalid tokens in device_tokens.
 *   6. Never throws — always returns a structured BulkPushNotificationResult.
 */
export async function sendBulkPushNotification(
  supabase: ReturnType<typeof createClient>,
  params: BulkPushNotificationParams,
): Promise<BulkPushNotificationResult> {
  const { profileIds, title, body, data, concurrency = DEFAULT_CONCURRENCY } = params;

  const result: BulkPushNotificationResult = {
    totalProfiles: profileIds.length,
    totalDevices: 0,
    successful: 0,
    failed: 0,
    invalidTokens: [],
  };

  if (profileIds.length === 0) {
    return result;
  }

  structuredLog('BULK_PUSH_START', {
    totalProfiles: profileIds.length,
    title,
    bodyLength: body.length,
    concurrency,
  });

  // ── Step 1: Load Firebase service account ────────────────────────────
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    result.failed = profileIds.length;
    return result;
  }

  const projectId = serviceAccount.project_id;

  // ── Step 2: Obtain cached OAuth access token ─────────────────────────
  let accessToken: string;
  try {
    accessToken = await getCachedAccessToken(serviceAccount);
  } catch (err) {
    structuredLog('BULK_PUSH_AUTH_ERROR', {
      error: err instanceof Error ? err.message : 'Failed to obtain OAuth access token',
    });
    result.failed = profileIds.length;
    return result;
  }

  // ── Step 3: Bulk lookup active device tokens in chunks of 500 ────────
  interface DeviceTask {
    profileId: string;
    token_id: string;
    fcm_token: string;
  }
  const deviceTasks: DeviceTask[] = [];

  for (let i = 0; i < profileIds.length; i += TOKEN_LOOKUP_CHUNK_SIZE) {
    const chunk = profileIds.slice(i, i + TOKEN_LOOKUP_CHUNK_SIZE);
    const { data: tokens, error: queryError } = await supabase
      .from('device_tokens')
      .select('token_id, profile_id, fcm_token, platform')
      .in('profile_id', chunk)
      .eq('is_active', true);

    if (queryError) {
      result.failed += chunk.length;
      structuredLog('BULK_TOKEN_LOOKUP_FAILED', {
        chunkIndex: i / TOKEN_LOOKUP_CHUNK_SIZE,
        error: queryError.message,
      });
      continue;
    }

    if (tokens && tokens.length > 0) {
      for (const row of tokens) {
        if (row.fcm_token) {
          deviceTasks.push({
            profileId: row.profile_id as string,
            token_id: row.token_id as string,
            fcm_token: row.fcm_token as string,
          });
        }
      }
    }
  }

  result.totalDevices = deviceTasks.length;

  if (deviceTasks.length === 0) {
    structuredLog('BULK_PUSH_NO_ACTIVE_DEVICES', { totalProfiles: profileIds.length });
    return result;
  }

  structuredLog('BULK_PUSH_DEVICES_RESOLVED', {
    totalProfiles: profileIds.length,
    totalDevices: deviceTasks.length,
  });

  // ── Step 4: Controlled Concurrency Worker Pool ────────────────────────
  const concurrencyLimit = Math.max(1, Math.min(concurrency, 50));
  let cursor = 0;
  const invalidTokenIds: string[] = [];
  const invalidFcmTokens: string[] = [];

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= deviceTasks.length) break;

      const task = deviceTasks[idx];
      try {
        const sendResult = await sendToDeviceWithRetry(
          accessToken,
          projectId,
          task.fcm_token,
          title,
          body,
          data,
        );

        if (sendResult.success) {
          result.successful++;
        } else {
          result.failed++;
          if (sendResult.invalidToken) {
            invalidTokenIds.push(task.token_id);
            invalidFcmTokens.push(task.fcm_token);
          }
        }
      } catch (err) {
        result.failed++;
        structuredLog('WORKER_TASK_ERROR', {
          profileId: task.profileId,
          error: err instanceof Error ? err.message : 'Unexpected task error',
        });
      }
    }
  }

  const workerCount = Math.min(concurrencyLimit, deviceTasks.length);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  result.invalidTokens = invalidFcmTokens;

  // ── Step 5: Bulk deactivate invalid tokens in chunks ─────────────────
  if (invalidTokenIds.length > 0) {
    for (let i = 0; i < invalidTokenIds.length; i += DEACTIVATE_CHUNK_SIZE) {
      const chunk = invalidTokenIds.slice(i, i + DEACTIVATE_CHUNK_SIZE);
      const { error: deactivateError } = await supabase
        .from('device_tokens')
        .update({ is_active: false })
        .in('token_id', chunk);

      if (deactivateError) {
        structuredLog('BULK_TOKEN_DEACTIVATE_FAILED', {
          error: deactivateError.message,
          count: chunk.length,
        });
      }
    }
    structuredLog('BULK_TOKENS_DEACTIVATED', { count: invalidTokenIds.length });
  }

  structuredLog('BULK_PUSH_COMPLETE', {
    totalProfiles: result.totalProfiles,
    totalDevices: result.totalDevices,
    successful: result.successful,
    failed: result.failed,
    invalidTokensCount: result.invalidTokens.length,
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — Single Recipient Push Dispatch (100% Backward Compatible)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a push notification to all active devices belonging to a user.
 *
 * Maintained for backward-compatibility with existing callers (e.g.
 * subscription-lifecycle, complete-course-purchase).
 *
 * Benefits from cached OAuth access token and retry backoff.
 * NEVER throws — always returns a PushNotificationResult.
 */
export async function sendPushNotification(
  supabase: ReturnType<typeof createClient>,
  params: PushNotificationParams,
): Promise<PushNotificationResult> {
  const { profileId, title, body, data } = params;

  structuredLog('PUSH_SEND_START', {
    profileId,
    title,
    bodyLength: body.length,
    hasData: data != null && Object.keys(data).length > 0,
  });

  const result: PushNotificationResult = {
    totalDevices: 0,
    successful: 0,
    failed: 0,
    invalidTokens: [],
  };

  try {
    // ── Step 1: Query active device tokens for this user ────────────────
    const { data: tokens, error: queryError } = await supabase
      .from('device_tokens')
      .select('token_id, fcm_token, platform')
      .eq('profile_id', profileId)
      .eq('is_active', true);

    if (queryError) {
      structuredLog('PUSH_FAILED', {
        profileId,
        error: queryError.message,
      });
      return result;
    }

    if (!tokens || tokens.length === 0) {
      structuredLog('DEVICE_TOKENS_FOUND', { profileId, count: 0 });
      return result;
    }

    result.totalDevices = tokens.length;

    // ── Step 2: Load service account ───────────────────────────────────
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      result.failed = tokens.length;
      return result;
    }

    const projectId = serviceAccount.project_id;

    // ── Step 3: Obtain cached OAuth access token ────────────────────────
    let accessToken: string;
    try {
      accessToken = await getCachedAccessToken(serviceAccount);
    } catch (err) {
      structuredLog('PUSH_FAILED', {
        profileId,
        error: err instanceof Error ? err.message : 'Failed to obtain OAuth access token',
      });
      result.failed = tokens.length;
      return result;
    }

    // ── Step 4: Send to each active device with retry ───────────────────
    for (const device of tokens as DeviceTokenRow[]) {
      const sendResult = await sendToDeviceWithRetry(
        accessToken,
        projectId,
        device.fcm_token,
        title,
        body,
        data,
      );

      if (sendResult.success) {
        result.successful++;
      } else {
        result.failed++;
        if (sendResult.invalidToken) {
          result.invalidTokens.push(device.fcm_token);
          await supabase
            .from('device_tokens')
            .update({ is_active: false })
            .eq('token_id', device.token_id);
        }
      }
    }

    structuredLog('PUSH_SUMMARY', {
      profileId,
      totalDevices: result.totalDevices,
      successful: result.successful,
      failed: result.failed,
      invalidTokensCount: result.invalidTokens.length,
    });
  } catch (err) {
    structuredLog('PUSH_FAILED', {
      profileId,
      error: err instanceof Error ? err.message : 'Unknown error in sendPushNotification',
      context: 'outer_catch_all',
    });
  }

  return result;
}

