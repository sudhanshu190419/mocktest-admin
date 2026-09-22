// ============================================================================
// Edge Function: recording-egress-start
//
// Starts recording a LiveKit room via the LiveKit Egress API and exports
// the output directly to Cloudflare R2 (S3-compatible).
//
// ── Authentication ─────────────────────────────────────────────────────────
// verify_jwt = true (configured in config.toml)
//
// The caller must be authenticated. This function verifies the JWT and
// resolves the caller's profile_id to determine if they are a teacher
// authorized to start recordings.
//
// ── Request Body ───────────────────────────────────────────────────────────
// {
//   "roomName": "class-abc12345",       // LiveKit room to record
//   "outputConfig": {
//     "bucket": "recorded-classes",     // Cloudflare R2 bucket
//     "filePrefix": "recordings/class-abc12345",  // Object key prefix
//     "fileFormat": "mp4"               // Output format (mp4, webm)
//   }
// }
//
// ── Response (Success) ─────────────────────────────────────────────────────
// {
//   "egressId": "EG_xxxxxxxx",
//   "storageBucket": "recorded-classes",
//   "storagePath": "recordings/class-abc12345-1743000000000.mp4"
// }
//
// storageBucket/storagePath are the exact R2 destination handed to LiveKit's
// S3 output config. Callers MUST persist them on the recordings row, because
// this function is the only place the reserved object key is known.
//
// ── Environment Variables ──────────────────────────────────────────────────
// LIVEKIT_API_KEY             — LiveKit API key (required)
// LIVEKIT_API_SECRET          — LiveKit API secret (required)
// LIVEKIT_URL                 — LiveKit server URL (required)
// SUPABASE_URL                — Auto-injected by Supabase
// SUPABASE_ANON_KEY           — Auto-injected by Supabase (caller client)
// SUPABASE_SERVICE_ROLE_KEY   — Service role key for privileged DB reads
// R2_ENDPOINT                 — Cloudflare R2 S3 endpoint
// R2_ACCESS_KEY               — Cloudflare R2 access key
// R2_SECRET_KEY               — Cloudflare R2 secret key
// R2_RECORDINGS_BUCKET        — Cloudflare R2 bucket name (fallback)
//
// @module edge-functions/recording-egress-start
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  EncodingOptionsPreset,
  S3Upload,
} from 'npm:livekit-server-sdk@2.13.2';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface StartEgressRequest {
  /** LiveKit room name to record. */
  roomName: string;
  /** R2 output configuration. */
  outputConfig?: {
    /** R2 bucket name. Defaults to environment variable. */
    bucket?: string;
    /** Object key prefix (e.g. "recordings/class-abc"). */
    filePrefix?: string;
    /** Output file format. Default: "mp4". */
    fileFormat?: 'mp4' | 'webm';
  };
}

interface StartEgressSuccessResponse {
  /** LiveKit Egress identifier. */
  egressId: string;
  /** R2 bucket the egress writes the recording file into. */
  storageBucket: string;
  /**
   * Exact R2 object key reserved for this egress — the same `key` that was
   * handed to LiveKit's S3 output config. It is never regenerated here, so
   * callers can persist it as the recording's storage_path before the
   * completion webhook arrives.
   */
  storagePath: string;
}

interface StartEgressErrorResponse {
  error: string;
}

type FunctionResponse = StartEgressSuccessResponse | StartEgressErrorResponse;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// ═══════════════════════════════════════════════════════════════════════════
// Structured Logging
// ═══════════════════════════════════════════════════════════════════════════

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'recording-egress-start',
      event,
      ...data,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Diagnostic-only helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a value returned by the LiveKit SDK/protobuf layer so it is safe
 * for JSON.stringify. Protobuf int64 fields (timestamps, durations, sizes)
 * arrive as `bigint`, which JSON.stringify throws on.
 *
 * Diagnostic logging only — never affects business logic.
 */
function toLogSafe(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/** Loose view of a LiveKit `EgressInfo`, used only for diagnostic logging. */
interface EgressLogInfo {
  egressId?: string;
  roomName?: string;
  status?: { toString(): string } | string | number;
  error?: string;
  details?: string;
  startedAt?: unknown;
  endedAt?: unknown;
  updatedAt?: unknown;
  fileResults?: EgressLogFile[];
}

/** Loose view of a LiveKit `FileInfo`, used only for diagnostic logging. */
interface EgressLogFile {
  filename?: string;
  duration?: unknown;
  size?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  status?: { toString(): string } | string | number;
  error?: string;
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
  structuredLog('EGRESS_START_ERROR', { error, statusCode: status });
  return jsonResponse({ error }, status);
}

/**
 * Validate that the caller is a teacher and has permission to record
 * the specified room.
 */
async function authenticateAndValidate(
  callerClient: ReturnType<typeof createClient>,
  serviceClient: ReturnType<typeof createClient>,
  authHeader: string | null,
  roomName: string,
): Promise<{ teacherId: string; instituteId: string } | { error: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header.' };
  }

  // Verify JWT and resolve the caller's identity via the anon client
  // bound to the incoming Authorization header.
  const { data: { user }, error: authError } = await callerClient.auth.getUser();
  if (authError || !user) {
    return { error: authError?.message ?? 'Authentication failed.' };
  }

  const profileId = user.id;

  // Query teacher_details via service-role client to confirm this user is
  // a teacher (bypasses RLS).
  const { data: teacher, error: teacherError } = await serviceClient
    .from('teacher_details')
    .select('teacher_id, profile_id')
    .eq('profile_id', profileId)
    .single();

  if (teacherError || !teacher) {
    return { error: 'User is not a registered teacher.' };
  }

  // Verify the room belongs to a live class owned by this teacher
  const { data: liveClass, error: classError } = await serviceClient
    .from('live_classes')
    .select('class_id, teacher_id, institute_id')
    .eq('room_name', roomName)
    .single();

  if (classError || !liveClass) {
    return { error: `Live class not found for room: ${roomName}` };
  }

  if (liveClass.teacher_id !== teacher.teacher_id) {
    return { error: 'You do not own this live class.' };
  }

  return {
    teacherId: teacher.teacher_id,
    instituteId: liveClass.institute_id,
  };
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
    // Step 1: Parse and validate request body
    // ══════════════════════════════════════════════════════════════════
    let body: StartEgressRequest;
    try {
      const raw = await req.json() as Record<string, unknown>;

      if (!raw.roomName || typeof raw.roomName !== 'string') {
        return errorResponse('Missing or invalid field: roomName (string required).');
      }

      body = {
        roomName: raw.roomName,
        outputConfig: {
          bucket: (raw.outputConfig as Record<string, unknown>)?.bucket as string ?? r2RecordingsBucket!,
          filePrefix: (raw.outputConfig as Record<string, unknown>)?.filePrefix as string ?? `recordings/${raw.roomName}`,
          fileFormat: ((raw.outputConfig as Record<string, unknown>)?.fileFormat as string ?? 'mp4') as 'mp4' | 'webm',
        },
      };

      structuredLog('REQUEST_VALIDATED', {
        roomName: body.roomName,
        bucket: body.outputConfig.bucket,
        filePrefix: body.outputConfig.filePrefix,
        fileFormat: body.outputConfig.fileFormat,
      });
    } catch {
      return errorResponse('Invalid request body. Expected valid JSON.', 400);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 2: Authenticate
    // ══════════════════════════════════════════════════════════════════
    //
    // Two-client pattern (matches _shared/adminIdentity.ts):
    //   callerClient — anon key + caller's Authorization header.
    //                  Used ONLY for auth.getUser() to resolve identity.
    //   serviceClient — service-role key. Used for privileged DB reads
    //                   (teacher_details, live_classes) that bypass RLS.
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader = req.headers.get('Authorization');

    if (!supabaseUrl || !supabaseServiceKey || !SUPABASE_ANON_KEY) {
      return errorResponse('Server configuration error: missing Supabase credentials.', 500);
    }

    const callerClient = createClient(supabaseUrl, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: { Authorization: authHeader ?? '' },
      },
    });

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const authResult = await authenticateAndValidate(
      callerClient,
      serviceClient,
      authHeader,
      body.roomName,
    );

    if ('error' in authResult) {
      return errorResponse(authResult.error, 403);
    }

    const { instituteId } = authResult;
    structuredLog('AUTH_SUCCESS', { instituteId, roomName: body.roomName });

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Get LiveKit & R2 credentials
    // ══════════════════════════════════════════════════════════════════
    const livekitApiKey = Deno.env.get('LIVEKIT_API_KEY');
    const livekitApiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    const livekitUrl = Deno.env.get('LIVEKIT_URL');
    const r2Endpoint = Deno.env.get('R2_ENDPOINT');
    const r2AccessKey = Deno.env.get('R2_ACCESS_KEY');
    const r2SecretKey = Deno.env.get('R2_SECRET_KEY');
    const r2RecordingsBucket = Deno.env.get('R2_RECORDINGS_BUCKET');

    if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
      return errorResponse('Server configuration error: missing LiveKit credentials. Set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL.', 500);
    }

    if (!r2Endpoint || !r2AccessKey || !r2SecretKey) {
      return errorResponse('Server configuration error: missing Cloudflare R2 credentials. Set R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY.', 500);
    }

    if (!r2RecordingsBucket) {
      return errorResponse('Server configuration error: missing R2_RECORDINGS_BUCKET.', 500);
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Configure R2 S3 output
    // ══════════════════════════════════════════════════════════════════
    const bucket = body.outputConfig!.bucket!;
    const keyPrefix = body.outputConfig!.filePrefix!;

    // Build the exact R2 object key — the same value LiveKit Egress will
    // write the MP4 into. Callers persist this as the recording's
    // storage_path.
    const outputKey = `${keyPrefix}-${Date.now()}.${body.outputConfig!.fileFormat ?? 'mp4'}`;

    // Construct the protobuf output objects using the SDK v2 classes.
    // S3Upload maps directly to the livekit.S3Upload protobuf message;
    // EncodedFileOutput wraps it in the required oneof structure.
    const s3Upload = new S3Upload({
      accessKey: r2AccessKey,
      secret: r2SecretKey,
      endpoint: r2Endpoint,
      bucket,
      region: 'auto',
      forcePathStyle: true,
    });

    const fileOutput = new EncodedFileOutput({
      filepath: outputKey,
      fileType: EncodedFileType.MP4,
      output: {
        case: 's3',
        value: s3Upload,
      },
    });

    structuredLog('S3_OUTPUT_CONFIGURED', {
      bucket,
      key: outputKey,
      endpoint: r2Endpoint.replace(/\/?$/, ''),
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 5: Start Egress via LiveKit EgressClient
    // ══════════════════════════════════════════════════════════════════
    //
    // We use RoomCompositeEgress which records the entire room (video +
    // audio) — the same as native LiveKit recording. Participants are
    // automatically laid out in a grid using the default template.
    //
    // Options:
    //   - fileOutputs: Array of file outputs (we use S3)
    //   - preset: H264_720P_30 gives a good balance of quality/size
    //   - fileType: Determines container format (.mp4 or .webm)
    try {
      const egressClient = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);

      structuredLog('EGRESS_START_REQUEST', {
        roomName: body.roomName,
        bucket,
        outputKey,
        webhookConfigured: true,
        webhookUrl: 'https://ocolfottogbybitfpdqy.supabase.co/functions/v1/recording-webhook',
      });

      const egress = await egressClient.startRoomCompositeEgress(
  body.roomName,
  {
    file: fileOutput,
  },
  {
    encodingOptions: EncodingOptionsPreset.H264_720P_30,
    webhooks: [
      {
        url: 'https://ocolfottogbybitfpdqy.supabase.co/functions/v1/recording-webhook',
        signingKey: livekitApiKey,
      },
    ],
  },
);

      const egressId = egress.egressId ?? egress.info?.egressId ?? '';

      const egressLogInfo = egress as unknown as EgressLogInfo | undefined;
      structuredLog('EGRESS_START_RESPONSE', {
        egressId,
        status: egressLogInfo?.status?.toString?.() ?? egressLogInfo?.status,
        roomName: egressLogInfo?.roomName || null,
        error: egressLogInfo?.error || null,
        details: egressLogInfo?.details || null,
        startedAt: toLogSafe(egressLogInfo?.startedAt) || null,
        endedAt: toLogSafe(egressLogInfo?.endedAt) || null,
      });

      structuredLog('EGRESS_STARTED', {
        egressId,
        roomName: body.roomName,
        outputKey,
        bucket,
      });

      // ══════════════════════════════════════════════════════════════
      // Step 6: Return success
      // ══════════════════════════════════════════════════════════════
      // Return the R2 destination alongside the egress ID so the caller can
      // persist the reserved artifact key on the recordings row.
      return jsonResponse({ egressId, storageBucket: bucket, storagePath: outputKey });
    } catch (livekitErr) {
      structuredLog('LIVEKIT_EGRESS_FAILED', {
        error: livekitErr instanceof Error ? livekitErr.message : 'Unknown LiveKit error',
        roomName: body.roomName,
        stack: livekitErr instanceof Error ? livekitErr.stack : undefined,
      });
      return errorResponse(
        `Failed to start LiveKit recording: ${livekitErr instanceof Error ? livekitErr.message : 'LiveKit API error'}`,
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
