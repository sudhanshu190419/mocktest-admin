// ============================================================================
// Edge Function: recording-playback-url
//
// Generates a time-limited signed (pre-signed) URL for streaming a
// recording from Cloudflare R2.
//
// ── Security Model (Phase 11J.3 — Course-Scoped Authorization) ─────────────
// The client NEVER supplies course, batch, subject, or entitlement
// information. The server derives everything itself:
//
//     JWT
//       ↓
//     authenticated user (user.id)
//       ↓
//     profiles                → authoritative role (never from the request body)
//       ↓
//     recordings (recordingId) → status, storage_bucket/path, class_id
//       ↓
//     batch_subject_recordings → batch_subject_ids
//       ↓
//     batch_subjects          → batch_ids (is_active = true)
//       ↓
//     course_batches          → course_id(s)
//       ↓
//     authorization
//
//   • Student:  allowed ONLY when BOTH hold:
//                 (a) an ACTIVE batch_students row in one of the
//                     recording's batches, AND
//                 (b) can_student_access_content(course_id) is TRUE for at
//                     least one course linked to the recording's batches
//                     (ANY-course semantics — same rule the RLS helpers use).
//   • Teacher:  allowed ONLY for recordings they own (recordings.teacher_id)
//               or whose source class they teach (live_classes.teacher_id).
//   • Admin:    full bypass.
//
// ── Request Body ───────────────────────────────────────────────────────────
// {
//   "recordingId": "uuid",         // Recording UUID (NOT storage path)
//   "expirySeconds": 300            // Optional: URL expiry in seconds
// }
//
// Any client-supplied courseId / batchId / subjectId is IGNORED. The signed
// URL is always derived from recordings.storage_bucket + storage_path loaded
// from the database.
//
// ── Response (Success) ─────────────────────────────────────────────────────
// {
//   "url": "https://...",
//   "expiresAt": "2026-07-26T12:00:00.000Z"
// }
//
// ── Environment Variables ──────────────────────────────────────────────────
// SUPABASE_URL              — Auto-injected by Supabase
// SUPABASE_ANON_KEY         — Auto-injected by Supabase
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

interface RecordingRow {
  recording_id: string;
  class_id: string | null;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
  is_deleted: boolean | null;
  teacher_id: string | null;
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

/** Standardized user-facing denial message (matches Phase 11C MESSAGES). */
const CONTENT_BLOCKED_MESSAGE =
  'Your content access period has ended. Renew your subscription to continue.';

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
 * Recording-scoped student authorization (Phase 11J.3).
 *
 * Both conditions must hold:
 *   1. The student holds an ACTIVE batch_students row in one of the
 *      recording's batches (batch_subject_recordings → batch_subjects,
 *      is_active = true).
 *   2. can_student_access_content(course_id) is TRUE for at least one
 *      course linked to those batches (ANY-course semantics).
 *
 * All lookups use the service-role client (never trusts the client). The
 * entitlement check reuses the existing RLS helper can_student_access_content
 * — which depends on auth.uid() — so it is invoked through the ANON client
 * that forwards the caller's JWT. Any RPC error fails CLOSED (denied).
 */
async function authorizeStudent(
  anonClient: ReturnType<typeof createClient>,
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  recording: RecordingRow,
): Promise<{ allowed: boolean; message?: string }> {
  // ── 1. Resolve the student's student_id ───────────────────────────────
  const { data: student } = await serviceClient
    .from('student_details')
    .select('student_id')
    .eq('profile_id', userId)
    .maybeSingle();

  if (!student?.student_id) {
    return { allowed: false, message: 'Student profile not found.' };
  }

  // ── 2. Resolve the recording's batch_subject_ids ──────────────────────
  const { data: bsrRows } = await serviceClient
    .from('batch_subject_recordings')
    .select('batch_subject_id')
    .eq('recording_id', recording.recording_id);

  const batchSubjectIds = (bsrRows ?? []).map((r: any) => r.batch_subject_id);
  if (batchSubjectIds.length === 0) {
    return { allowed: false, message: 'This recording is not assigned to any batch.' };
  }

  // ── 3. Resolve batch_ids (active batch-subjects only) ─────────────────
  const { data: bsList } = await serviceClient
    .from('batch_subjects')
    .select('batch_id')
    .in('batch_subject_id', batchSubjectIds)
    .eq('is_active', true);

  const batchIds = [...new Set((bsList ?? []).map((r: any) => r.batch_id))] as string[];
  if (batchIds.length === 0) {
    return { allowed: false, message: 'This recording is not assigned to any active batch.' };
  }

  // ── 4. Batch membership — student must be ACTIVE in one of THESE batches ─
  const { data: membership } = await serviceClient
    .from('batch_students')
    .select('batch_id')
    .in('batch_id', batchIds)
    .eq('student_id', student.student_id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return { allowed: false, message: 'You are not assigned to this recording.' };
  }

  // ── 5. Derive the linked course_ids ───────────────────────────────────
  const { data: cbRows } = await serviceClient
    .from('course_batches')
    .select('course_id')
    .in('batch_id', batchIds);

  const courseIds = [...new Set((cbRows ?? []).map((r: any) => r.course_id))] as string[];
  if (courseIds.length === 0) {
    return { allowed: false, message: CONTENT_BLOCKED_MESSAGE };
  }

  // ── 6. Entitlement — can_student_access_content per course (ANY) ──────
  //      Invoked through the anon client with the caller's JWT so the
  //      helper's auth.uid()/get_my_student_id() resolve to THIS student.
  for (const courseId of courseIds) {
    try {
      const { data: allowed, error } = await anonClient.rpc(
        'can_student_access_content',
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

  return { allowed: false, message: CONTENT_BLOCKED_MESSAGE };
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
    // the can_student_access_content RPC (which needs auth.uid()).
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
    // Step 2: Parse and validate the request body
    // ══════════════════════════════════════════════════════════════════
    // Only recordingId + optional expirySeconds are accepted. Any
    // client-supplied courseId / batchId / subjectId is ignored — the
    // server derives everything itself.
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

    // 3b. Look up the recording from the DB (authoritative source).
    // NOTE: uses select('*') — deliberately schema-agnostic. The repository
    // contains two divergent recordings definitions (005 without
    // teacher_id/batch_id/is_deleted, 065 with them); an explicit column
    // list could 400 against the deployed shape and break playback for
    // everyone. Fields are read defensively below (undefined → falsy).
    const { data: recording, error: recordingError } = await serviceClient
      .from('recordings')
      .select('*')
      .eq('recording_id', body.recordingId)
      .maybeSingle();

    if (recordingError || !recording) {
      structuredLog('RECORDING_NOT_FOUND', { recordingId: body.recordingId });
      return errorResponse('Recording not found.', 404);
    }

    const rec = {
      recording_id: recording.recording_id as string,
      class_id: (recording as Record<string, unknown>).class_id as string | null ?? null,
      status: recording.status as string,
      storage_bucket: (recording as Record<string, unknown>).storage_bucket as string | null ?? null,
      storage_path: (recording as Record<string, unknown>).storage_path as string | null ?? null,
      is_deleted: (recording as Record<string, unknown>).is_deleted as boolean | null ?? null,
      teacher_id: (recording as Record<string, unknown>).teacher_id as string | null ?? null,
    } satisfies RecordingRow;

    // ── Verify recording is completed ──────────────────────────────────
    if (rec.status !== 'completed') {
      return errorResponse(
        `Recording is not ready for playback. Current status: ${rec.status}`,
        403,
      );
    }

    // ── Verify recording is not soft-deleted ───────────────────────────
    if (rec.is_deleted) {
      return errorResponse('Recording has been deleted.', 410);
    }

    // ── Verify recording has a storage path ───────────────────────────
    if (!rec.storage_path) {
      return errorResponse('Recording has no storage path.', 500);
    }

    structuredLog('RECORDING_FOUND', {
      recordingId: rec.recording_id,
      status: rec.status,
      hasStoragePath: !!rec.storage_path,
      storageBucket: rec.storage_bucket ?? 'default',
      hasClass: rec.class_id !== null,
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Role-based authorization
    // ══════════════════════════════════════════════════════════════════
    if (role === 'admin') {
      // Admin: full bypass.
      structuredLog('ADMIN_BYPASS', { recordingId: rec.recording_id });
    } else if (role === 'teacher') {
      // Teacher: may only access recordings they own.
      const { data: teacher } = await serviceClient
        .from('teacher_details')
        .select('teacher_id')
        .eq('profile_id', userId)
        .maybeSingle();

      let ownsRecording = false;

      // Ownership via the denormalized recordings.teacher_id (current schema).
      if (teacher && rec.teacher_id && rec.teacher_id === teacher.teacher_id) {
        ownsRecording = true;
      }

      // Ownership via the source class (recordings.class_id →
      // live_classes.teacher_id) — authoritative when the recording belongs
      // to a live class the teacher taught.
      if (!ownsRecording && teacher && rec.class_id) {
        const { data: liveClass } = await serviceClient
          .from('live_classes')
          .select('teacher_id')
          .eq('class_id', rec.class_id)
          .maybeSingle();

        if (liveClass && liveClass.teacher_id === teacher.teacher_id) {
          ownsRecording = true;
        }
      }

      if (!ownsRecording) {
        structuredLog('TEACHER_OWNERSHIP_DENIED', {
          recordingId: rec.recording_id,
          recordingTeacherId: rec.teacher_id,
          classId: rec.class_id,
        });
        return errorResponse('You do not own this recording.', 403);
      }

      structuredLog('TEACHER_OWNERSHIP_GRANTED', { recordingId: rec.recording_id });
    } else if (role === 'student') {
      // Student: batch membership AND course-scoped content entitlement.
      const decision = await authorizeStudent(supabase, serviceClient, userId, rec);

      if (!decision.allowed) {
        structuredLog('STUDENT_AUTHORIZATION_DENIED', {
          recordingId: rec.recording_id,
          reason: decision.message,
        });
        return errorResponse(decision.message ?? CONTENT_BLOCKED_MESSAGE, 403);
      }

      structuredLog('STUDENT_AUTHORIZATION_GRANTED', {
        recordingId: rec.recording_id,
      });
    } else {
      return errorResponse('Unauthorized role. Access denied.', 403);
    }

    structuredLog('ACCESS_GRANTED', {
      userId,
      recordingId: rec.recording_id,
      role,
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
    const storagePath = rec.storage_path as string;
    const storageBucket = rec.storage_bucket ?? r2RecordingsBucket;

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
        recordingId: rec.recording_id,
        bucket: storageBucket,
        expiresAt,
        urlPrefix: url.slice(0, 80) + '...',
      });

      return jsonResponse({ url, expiresAt });
    } catch (signingErr) {
      structuredLog('URL_GENERATION_FAILED', {
        error: signingErr instanceof Error ? signingErr.message : 'Unknown signing error',
        recordingId: rec.recording_id,
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
