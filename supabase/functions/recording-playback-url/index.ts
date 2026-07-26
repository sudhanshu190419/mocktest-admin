// ============================================================================
// Edge Function: recording-playback-url
//
// Generates a time-limited signed (pre-signed) URL for streaming a
// recording from Cloudflare R2.
//
// ── Security Model ─────────────────────────────────────────────────────────
// 1. Accepts recording_id (NOT storage_path) from the client
// 2. Queries the recordings table for the authoritative storage_path/bucket
// 3. Verifies the recording exists, is completed, and not soft-deleted
// 4. Verifies the caller has access:
//    - Teacher: owns the recording
//    - Student: enrolled in the recording's batch
//    - Admin: any recording
// 5. Generates a short-lived signed URL using DB values
//    Never trusts client-provided storage paths.
//
// ── Request Body ───────────────────────────────────────────────────────────
// {
//   "recordingId": "uuid",         // Recording UUID (NOT storage path)
//   "expirySeconds": 300            // Optional: URL expiry in seconds
// }
//
// ── Response (Success) ─────────────────────────────────────────────────────
// {
//   "url": "https://...",
//   "expiresAt": "2026-07-26T12:00:00.000Z"
// }
//
// ── Environment Variables ──────────────────────────────────────────────────
// SUPABASE_URL              — Auto-injected by Supabase
// SUPABASE_SERVICE_ROLE_KEY — Service role key for DB access
// R2_ENDPOINT               — Cloudflare R2 S3 endpoint
// R2_ACCESS_KEY             — Cloudflare R2 access key ID
// R2_SECRET_KEY             — Cloudflare R2 secret access key
// R2_RECORDINGS_BUCKET      — Cloudflare R2 bucket name
//
// @module edge-functions/recording-playback-url
// ============================================================================

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

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface PlaybackUrlRequest {
  /** Recording UUID (NOT storage path). Server resolves the path from the DB. */
  recordingId: string;
  /** Signed URL expiry in seconds. Default: 300 (5 minutes). Max: 3600 (1 hour). */
  expirySeconds?: number;
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

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MIN_EXPIRY = 60;      // 1 minute minimum
const MAX_EXPIRY = 3600;    // 1 hour maximum
const DEFAULT_EXPIRY = 300; // 5 minutes

// ═══════════════════════════════════════════════════════════════════════════
// Structured Logging
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function jsonResponse(body: FunctionResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 400): Response {
  structuredLog('PLAYBACK_URL_ERROR', { error, statusCode: status });
  return jsonResponse({ error }, status);
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
  region: string,
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

// ═══════════════════════════════════════════════════════════════════════════
// Access Control
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify the caller has access to the recording.
 *
 * Security model:
 * - Teacher: can access only recordings they own (teacher_id match)
 * - Student: can access completed recordings in batches they are enrolled in
 * - Admin: can access every recording
 *
 * @returns The user's role if authorized, or an error string.
 */
async function verifyAccess(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  recording: Record<string, unknown>,
): Promise<{ authorized: true; role: string } | { authorized: false; error: string }> {
  // Check the caller's role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('profile_id', userId)
    .single();

  const role = (profile?.role as string) ?? '';
  const teacherId = recording.teacher_id as string;
  const batchId = recording.batch_id as string | null;

  // Admin: full access
  if (role === 'admin') {
    return { authorized: true, role };
  }

  // Teacher: can access only recordings they own
  if (role === 'teacher') {
    // Look up teacher_id by profile_id
    const { data: teacher } = await supabase
      .from('teacher_details')
      .select('teacher_id')
      .eq('profile_id', userId)
      .single();

    if (teacher && teacher.teacher_id === teacherId) {
      return { authorized: true, role };
    }
    return { authorized: false, error: 'You do not own this recording.' };
  }

  // Student: must be enrolled in the recording's batch
  if (batchId) {
    const { data: student } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('profile_id', userId)
      .single();

    if (student) {
      const { data: membership } = await supabase
        .from('batch_students')
        .select('batch_id')
        .eq('batch_id', batchId)
        .eq('student_id', student.student_id)
        .limit(1)
        .maybeSingle();

      if (membership) {
        return { authorized: true, role };
      }
    }
  }

  return { authorized: false, error: 'You do not have access to this recording.' };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  structuredLog('REQUEST_RECEIVED', { method: req.method });

  try {
    // ══════════════════════════════════════════════════════════════════
    // Step 1: Parse request body
    // ══════════════════════════════════════════════════════════════════
    let body: PlaybackUrlRequest;
    try {
      const raw = await req.json() as Record<string, unknown>;

      if (!raw.recordingId || typeof raw.recordingId !== 'string') {
        return errorResponse('Missing or invalid field: recordingId (UUID string required).');
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

    // ══════════════════════════════════════════════════════════════════
    // Step 2: Authenticate
    // ══════════════════════════════════════════════════════════════════
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse('Server configuration error: missing Supabase credentials.', 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authentication required.', 401);
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse('Invalid or expired authentication token.', 401);
    }

    structuredLog('AUTH_SUCCESS', { userId: user.id, recordingId: body.recordingId });

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Look up recording from DB (authoritative source)
    // ══════════════════════════════════════════════════════════════════
    const { data: recording, error: recordingError } = await supabase
      .from('recordings')
      .select('*')
      .eq('recording_id', body.recordingId)
      .single();

    if (recordingError || !recording) {
      return errorResponse('Recording not found.', 404);
    }

    // ── Verify recording is completed ──────────────────────────────────
    if (recording.status !== 'completed') {
      return errorResponse(
        `Recording is not ready for playback. Current status: ${recording.status}`,
        403,
      );
    }

    // ── Verify recording is not soft-deleted ───────────────────────────
    if (recording.is_deleted) {
      return errorResponse('Recording has been deleted.', 410);
    }

    // ── Verify recording has a storage path ───────────────────────────
    if (!recording.storage_path) {
      return errorResponse('Recording has no storage path.', 500);
    }

    structuredLog('RECORDING_FOUND', {
      recordingId: body.recordingId,
      status: recording.status,
      hasStoragePath: !!recording.storage_path,
      storageBucket: recording.storage_bucket ?? 'default',
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Verify caller has access to this recording
    // ══════════════════════════════════════════════════════════════════
    const accessResult = await verifyAccess(supabase, user.id, recording);

    if (!accessResult.authorized) {
      structuredLog('ACCESS_DENIED', {
        userId: user.id,
        recordingId: body.recordingId,
        reason: accessResult.error,
      });
      return errorResponse(accessResult.error, 403);
    }

    structuredLog('ACCESS_GRANTED', {
      userId: user.id,
      recordingId: body.recordingId,
      role: accessResult.role,
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 5: Load R2 credentials
    // ══════════════════════════════════════════════════════════════════
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

    // ══════════════════════════════════════════════════════════════════
    // Step 6: Use DB values (never trust client) to generate signed URL
    // ══════════════════════════════════════════════════════════════════
    const storagePath = recording.storage_path as string;
    const storageBucket = (recording.storage_bucket as string) ?? r2RecordingsBucket;

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
