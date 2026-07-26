// ============================================================================
// Edge Function: recording-delete
//
// Deletes a recording file from Cloudflare R2.
//
// This function performs a HARD DELETE of the recording file from storage.
// It should be called AFTER the recordings table row has been soft-deleted
// (or as part of a cleanup job for recordings that have been soft-deleted
// for more than 90 days).
//
// ── Authentication ─────────────────────────────────────────────────────────
// verify_jwt = true (configured in config.toml)
//
// Only admins and the owning teacher can delete recording files.
//
// ── Request Body ───────────────────────────────────────────────────────────
// {
//   "storagePath": "recordings/class-abc/1743000000000.mp4",
//   "bucket": "recorded-classes"
// }
//
// ── Response ───────────────────────────────────────────────────────────────
// { "success": true, "deleted": true }
//
// ── Environment Variables ──────────────────────────────────────────────────
// SUPABASE_URL              — Auto-injected by Supabase
// SUPABASE_SERVICE_ROLE_KEY — Service role key for DB access
// R2_ENDPOINT               — Cloudflare R2 S3 endpoint
// R2_ACCESS_KEY             — Cloudflare R2 access key ID
// R2_SECRET_KEY             — Cloudflare R2 secret access key
//
// @module edge-functions/recording-delete
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  toBytes,
  toHex,
  sha256,
  sha256Hex,
  hmacSha256,
  getSignatureKey,
  getAmzDates,
} from '../_shared/s3Signing.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface DeleteRecordingRequest {
  /** Object key (path) within the R2 bucket. */
  storagePath: string;
  /** R2 bucket name. Defaults to R2_RECORDINGS_BUCKET env var. */
  bucket?: string;
}

interface DeleteRecordingSuccessResponse {
  success: true;
  deleted: boolean;
}

interface DeleteRecordingErrorResponse {
  success: false;
  error: string;
}

type FunctionResponse = DeleteRecordingSuccessResponse | DeleteRecordingErrorResponse;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ═══════════════════════════════════════════════════════════════════════════
// Structured Logging
// ═══════════════════════════════════════════════════════════════════════════

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'recording-delete',
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
  structuredLog('DELETE_ERROR', { error, statusCode: status });
  return jsonResponse({ success: false, error }, status);
}

/**
 * Delete an object from Cloudflare R2 via the S3-compatible API.
 *
 * Uses AWS Signature V4 for authentication (DELETE request).
 */
async function deleteFromR2(
  endpoint: string,
  accessKey: string,
  secretKey: string,
  bucket: string,
  key: string,
  region: string,
): Promise<boolean> {
  const now = new Date();
  const { dateStamp, amzDate } = getAmzDates(now);

  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const host = `${bucket}.${endpoint.replace(/^https?:\/\//, '')}`;
  const url = `https://${host}/${encodedKey}`;

  // ── AWS SigV4 signing for DELETE ──────────────────────────────────────
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = await sha256Hex('');

  const canonicalRequest = [
    'DELETE',
    `/${encodedKey}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    toHex(await sha256(canonicalRequest)),
  ].join('\n');

  const signingKey = await getSignatureKey(secretKey, dateStamp, region, 's3');
  const signatureBytes = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(signatureBytes);

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // ── Send DELETE request ───────────────────────────────────────────────
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': authorization,
      'X-Amz-Date': amzDate,
      'Host': host,
    },
  });

  if (response.status === 204 || response.status === 200) {
    return true;
  }

  if (response.status === 404) {
    // Object not found — consider it already deleted
    structuredLog('OBJECT_NOT_FOUND', { bucket, key });
    return true;
  }

  const responseBody = await response.text().catch(() => '');
  throw new Error(`R2 DELETE failed (HTTP ${response.status}): ${responseBody.slice(0, 500)}`);
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
    // Step 1: Validate env vars before processing request
    // ══════════════════════════════════════════════════════════════════
    const r2RecordingsBucket = Deno.env.get('R2_RECORDINGS_BUCKET');
    if (!r2RecordingsBucket) {
      return errorResponse('Server configuration error: missing R2_RECORDINGS_BUCKET.', 500);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 2: Parse request body
    // ══════════════════════════════════════════════════════════════════
    let body: DeleteRecordingRequest;
    try {
      const raw = await req.json() as Record<string, unknown>;

      if (!raw.storagePath || typeof raw.storagePath !== 'string') {
        return errorResponse('Missing or invalid field: storagePath (string required).');
      }

      body = {
        storagePath: raw.storagePath,
        bucket: r2RecordingsBucket,
      };

      structuredLog('REQUEST_VALIDATED', {
        storagePath: body.storagePath,
        bucket: body.bucket,
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

    // Verify caller is admin or the teacher who owns this recording
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('profile_id', user.id)
      .single();

    const isAdmin = profile?.role === 'admin';
    const isTeacher = profile?.role === 'teacher';

    if (!isAdmin && !isTeacher) {
      return errorResponse('Only admins and teachers can delete recordings.', 403);
    }

    structuredLog('AUTH_SUCCESS', {
      userId: user.id,
      role: profile?.role ?? 'unknown',
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Load R2 credentials
    // ══════════════════════════════════════════════════════════════════
    const r2Endpoint = Deno.env.get('R2_ENDPOINT');
    const r2AccessKey = Deno.env.get('R2_ACCESS_KEY');
    const r2SecretKey = Deno.env.get('R2_SECRET_KEY');
    const r2Region = Deno.env.get('R2_REGION') ?? 'auto';

    if (!r2Endpoint || !r2AccessKey || !r2SecretKey) {
      return errorResponse('Server configuration error: missing Cloudflare R2 credentials.', 500);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Delete the object from R2
    // ══════════════════════════════════════════════════════════════════
    try {
      const cleanEndpoint = r2Endpoint.replace(/\/+$/, '');
      const deleted = await deleteFromR2(
        cleanEndpoint,
        r2AccessKey,
        r2SecretKey,
        body.bucket!,
        body.storagePath,
        r2Region,
      );

      structuredLog('DELETE_COMPLETE', {
        storagePath: body.storagePath,
        bucket: body.bucket,
        deleted,
      });

      return jsonResponse({ success: true, deleted });
    } catch (r2Err) {
      structuredLog('R2_DELETE_FAILED', {
        error: r2Err instanceof Error ? r2Err.message : 'Unknown R2 error',
        storagePath: body.storagePath,
        bucket: body.bucket,
      });
      return errorResponse(
        `Failed to delete recording from storage: ${r2Err instanceof Error ? r2Err.message : 'R2 error'}`,
        502,
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
