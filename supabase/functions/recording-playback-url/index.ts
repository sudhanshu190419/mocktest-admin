/**
 * ============================================================================
 * Supabase Edge Function: recording-playback-url
 * ============================================================================
 *
 * Generates an AWS Signature V4 pre-signed GET URL for streaming a recorded
 * class from Cloudflare R2.
 *
 * ## Security & Authorization Model
 *
 *   Access authorization is consolidated into a single PostgreSQL RPC:
 *     public.verify_recording_playback_access(p_recording_id)
 *
 *   The RPC is SECURITY DEFINER with an empty search_path, deriving caller
 *   identity strictly from auth.uid() via the caller's JWT. It enforces:
 *     - Authenticated caller check (401)
 *     - Institute / tenant isolation (403)
 *     - Recording existence (404), completed status (403), non-deleted (410),
 *       and valid storage path (500)
 *     - Admin: full bypass
 *     - Teacher: owns recording (recordings.teacher_id or live_classes.teacher_id)
 *     - Student: active batch assignment (batch_subject_recordings + batch_subjects),
 *                active student membership (batch_students), and course content
 *                entitlement via public.can_student_access_content(course_id).
 *
 * ## Request Body
 * {
 *   "recordingId": "uuid",         // Recording UUID (NOT storage path)
 *   "expirySeconds": 300            // Optional: URL expiry in seconds (60-3600)
 * }
 *
 * Any client-supplied courseId / batchId / subjectId is IGNORED. The signed
 * URL is always derived from the database-verified storage_bucket + storage_path.
 *
 * ## Response (Success)
 * {
 *   "url": "https://...",
 *   "expiresAt": "2026-07-26T12:00:00.000Z"
 * }
 *
 * ## Environment Variables
 * SUPABASE_URL              — Auto-injected by Supabase
 * SUPABASE_ANON_KEY         — Auto-injected by Supabase
 * R2_ENDPOINT               — Cloudflare R2 S3 endpoint
 * R2_ACCESS_KEY             — Cloudflare R2 access key ID
 * R2_SECRET_KEY             — Cloudflare R2 secret access key
 * R2_RECORDINGS_BUCKET      — Cloudflare R2 bucket name
 *
 * @module edge-functions/recording-playback-url
 * ============================================================================
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  toBytes,
  toHex,
  sha256,
  hmacSha256,
  getSignatureKey,
  hashCanonicalRequest,
  getAmzDates,
} from '../_shared/s3Signing.ts';

// ── Types ───────────────────────────────────────────────────────────────────

interface PlaybackUrlRequest {
  /** Recording UUID (NOT storage path). Server resolves the path from the DB. */
  recordingId: string;
  /** Signed URL expiry in seconds. Default: 300 (5 minutes). Max: 3600 (1 hour). */
  expirySeconds?: number;
}

interface PlaybackAccessResult {
  allowed: boolean;
  status_code: number;
  error_code?: string | null;
  error_message?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  role?: string | null;
}

interface PlaybackUrlSuccessResponse {
  /** Pre-signed URL for streaming. */
  url: string;
  /** ISO 8601 timestamp when the URL expires. */
  expiresAt: string;
}

interface PlaybackUrlErrorResponse {
  error: string;
}

type FunctionResponse = PlaybackUrlSuccessResponse | PlaybackUrlErrorResponse;

// ── Constants ───────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_EXPIRY = 60;      // 1 minute minimum
const MAX_EXPIRY = 3600;    // 1 hour maximum
const DEFAULT_EXPIRY = 300; // 5 minutes

/** Standardized user-facing denial message (matches Phase 11C MESSAGES). */
const CONTENT_BLOCKED_MESSAGE =
  'Your content access period has ended. Renew your subscription to continue.';

// ── Structured Logging ──────────────────────────────────────────────────────

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'recording-playback-url',
      event,
      ...data,
    }),
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(body: FunctionResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(error: string, status = 400): Response {
  structuredLog('PLAYBACK_URL_ERROR', { error, statusCode: status });
  return jsonResponse({ error }, status);
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Generate an AWS Signature V4 pre-signed URL for Cloudflare R2.
 */
async function generatePresignedUrl(
  endpoint: string,
  accessKey: string,
  secretKey: string,
  bucket: string,
  key: string,
  expiresInSeconds: number,
  region = 'auto',
): Promise<{ url: string; expiresAt: string }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);
  const { dateStamp, amzDate } = getAmzDates(now);

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const host = `${bucket}.${endpoint.replace(/^https?:\/\//, '')}`;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${dateStamp}/${region}/s3/aws4_request`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalRequest = [
    'GET',
    `/${encodedKey}`,
    queryParams.toString(),
    `host:${host}`,
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await hashCanonicalRequest(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(secretKey, dateStamp, region, 's3');
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(signatureBytes);

  queryParams.set('X-Amz-Signature', signature);
  const url = `https://${host}/${encodedKey}?${queryParams.toString()}`;

  return { url, expiresAt: expiresAt.toISOString() };
}

// ── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  structuredLog('REQUEST_RECEIVED', { method: req.method });

  try {
    // ── Step 1: Validate Authorization header ─────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
    }

    // ── Step 2: Parse and validate the request body ────────────────────────
    let body: PlaybackUrlRequest;
    try {
      const raw = await req.json() as Record<string, unknown>;

      if (typeof raw.recordingId !== 'string' || !isValidUuid(raw.recordingId)) {
        return errorResponse(
          'Missing or invalid field: recordingId (UUID string required).',
          400,
        );
      }

      const expirySecondsRaw = raw.expirySeconds as number | undefined;
      const expirySeconds = expirySecondsRaw
        ? Math.max(MIN_EXPIRY, Math.min(MAX_EXPIRY, expirySecondsRaw))
        : DEFAULT_EXPIRY;

      body = { recordingId: raw.recordingId, expirySeconds };

      structuredLog('REQUEST_VALIDATED', {
        recordingId: body.recordingId,
        expirySeconds: body.expirySeconds,
      });
    } catch {
      return errorResponse('Invalid request body. Expected valid JSON.', 400);
    }

    // ── Step 3: Initialize Supabase client forwarding caller JWT ──────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      return errorResponse(
        'Server configuration error: missing Supabase credentials.',
        500,
      );
    }

    // The anon client forwards the caller's JWT so PostgREST sets auth.uid()
    // in the PostgreSQL session, ensuring the RPC executes with the caller's identity.
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

    // ── Step 4: Consolidated verification RPC call ─────────────────────────
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'verify_recording_playback_access',
      { p_recording_id: body.recordingId },
    );

    if (rpcError) {
      structuredLog('AUTH_RPC_ERROR', {
        error: rpcError.message,
        code: rpcError.code,
        recordingId: body.recordingId,
      });

      const isAuthError =
        rpcError.message.toLowerCase().includes('jwt') ||
        rpcError.message.toLowerCase().includes('token') ||
        rpcError.code === 'PGRST301' ||
        rpcError.message.toLowerCase().includes('unauthorized');

      return errorResponse(
        isAuthError ? 'Invalid or expired authentication token.' : 'Failed to verify recording playback access.',
        isAuthError ? 401 : 500,
      );
    }

    const accessResult = rpcData as PlaybackAccessResult | null;
    if (!accessResult) {
      structuredLog('AUTH_RPC_EMPTY_RESPONSE', { recordingId: body.recordingId });
      return errorResponse('Failed to verify recording playback access.', 500);
    }

    if (!accessResult.allowed) {
      structuredLog('ACCESS_DENIED', {
        recordingId: body.recordingId,
        errorCode: accessResult.error_code,
        statusCode: accessResult.status_code,
        reason: accessResult.error_message,
      });
      return errorResponse(
        accessResult.error_message ?? CONTENT_BLOCKED_MESSAGE,
        accessResult.status_code ?? 403,
      );
    }

    structuredLog('ACCESS_GRANTED', {
      recordingId: body.recordingId,
      role: accessResult.role ?? 'unknown',
    });

    // ── Step 5: Load R2 credentials ───────────────────────────────────────
    const r2Endpoint = Deno.env.get('R2_ENDPOINT');
    const r2AccessKey = Deno.env.get('R2_ACCESS_KEY');
    const r2SecretKey = Deno.env.get('R2_SECRET_KEY');
    const r2Region = Deno.env.get('R2_REGION') ?? 'auto';
    const r2RecordingsBucket = Deno.env.get('R2_RECORDINGS_BUCKET');

    if (!r2Endpoint || !r2AccessKey || !r2SecretKey) {
      return errorResponse('Server configuration error: missing Cloudflare R2 credentials.', 500);
    }

    if (!r2RecordingsBucket) {
      return errorResponse('Server configuration error: missing R2_RECORDINGS_BUCKET.', 500);
    }

    // ── Step 6: Generate signed URL with DB-verified values ────────────────
    const storagePath = accessResult.storage_path as string;
    const storageBucket = accessResult.storage_bucket ?? r2RecordingsBucket;

    try {
      const cleanEndpoint = r2Endpoint.replace(/\/+$/, '');
      const { url, expiresAt } = await generatePresignedUrl(
        cleanEndpoint,
        r2AccessKey,
        r2SecretKey,
        storageBucket,
        storagePath,
        body.expirySeconds!,
        r2Region,
      );

      structuredLog('URL_GENERATED', {
        recordingId: body.recordingId,
        bucket: storageBucket,
        expiresAt,
        urlPrefix: url.slice(0, 80) + '...',
      });

      return jsonResponse({ url, expiresAt });
    } catch (signingErr) {
      structuredLog('URL_GENERATION_FAILED', {
        error: signingErr instanceof Error ? signingErr.message : 'Unknown signing error',
        recordingId: body.recordingId,
      });
      return errorResponse(
        `Failed to generate playback URL: ${signingErr instanceof Error ? signingErr.message : 'Signing error'}`,
        500,
      );
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
