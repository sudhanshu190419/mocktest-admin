// ============================================================================
// Edge Function: livekit-webhook
//
// Receives webhook events from the LiveKit server and processes them for
// automatic attendance tracking.
//
// LiveKit sends POST requests to this endpoint when:
//   - A participant joins a room (participant_joined)
//   - A participant leaves a room (participant_left)
//   - A room ends (room_finished)
//
// This function:
//   1. Verifies the webhook signature (JWT) using WebhookReceiver
//   2. Extracts room name and participant identity
//   3. Resolves the participant identity to a student_id
//   4. Records the join/leave event in the attendance system
//
// Environment variables required:
//   SUPABASE_URL              — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)
//   LIVEKIT_API_KEY           — LiveKit project API key
//   LIVEKIT_API_SECRET        — LiveKit project API secret
//
// POST /functions/v1/livekit-webhook
//
// Webhook payload (LiveKit format):
// {
//   "event": "participant_joined" | "participant_left" | "room_finished",
//   "room": { "name": "class-abc12345", "sid": "...", ... },
//   "participant": { "identity": "student-uuid", "name": "...", ... },
//   "created_at": 1712345678,
//   ...
// }
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyWebhook } from './verify.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface LiveKitWebhookPayload {
  event: string;
  room: {
    name: string;
    sid: string;
    empty_timeout: number;
    creation_time: number;
    turn_password: string;
    enabled_codecs: Array<{ mime: string }>;
  };
  participant?: {
    identity: string;
    name: string;
    sid: string;
    state: number;
    joined_at: number;
  };
  id: string;
  createdAt: number;
}

interface WebhookResponse {
  success: boolean;
  processed: number;
  errors: string[];
}

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
      service: 'livekit-webhook',
      event,
      ...data,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function jsonResponse(body: WebhookResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

/**
 * Resolve a LiveKit participant identity (which is the profile_id) to a
 * student_id by querying student_details.
 */
async function resolveParticipantToStudent(
  supabase: ReturnType<typeof createClient>,
  identity: string,
): Promise<string | null> {
  // The identity is the profile_id (auth.uid()) of the student
  try {
    const { data, error } = await supabase
      .from('student_details')
      .select('student_id')
      .eq('profile_id', identity)
      .maybeSingle();

    if (error || !data) {
      // The participant might be a teacher — skip silently
      structuredLog('PARTICIPANT_NOT_STUDENT', {
        identity,
        reason: error?.message ?? 'No student_details row found',
      });
      return null;
    }
    return data.student_id;
  } catch (err) {
    structuredLog('PARTICIPANT_RESOLVE_ERROR', {
      identity,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Resolve a LiveKit room name to a class_id by querying live_classes.
 */
async function resolveRoomToClass(
  supabase: ReturnType<typeof createClient>,
  roomName: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('live_classes')
      .select('class_id')
      .eq('room_name', roomName)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      structuredLog('ROOM_NOT_FOUND', {
        roomName,
        reason: error?.message ?? 'No live_classes row has this room_name',
      });
      return null;
    }
    return data.class_id;
  } catch (err) {
    structuredLog('ROOM_RESOLVE_ERROR', {
      roomName,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Handlers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle a participant_joined event.
 *
 * Records the student's join in the attendance system.
 */
async function handleParticipantJoined(
  supabase: ReturnType<typeof createClient>,
  payload: LiveKitWebhookPayload,
): Promise<string | null> {
  const roomName = payload.room?.name;
  const identity = payload.participant?.identity;

  if (!roomName || !identity) {
    structuredLog('INVALID_PAYLOAD', {
      event: 'participant_joined',
      hasRoom: !!roomName,
      hasParticipant: !!identity,
    });
    return 'Missing room name or participant identity';
  }

  // Resolve room to class_id
  const classId = await resolveRoomToClass(supabase, roomName);
  if (!classId) return `Room ${roomName} not mapped to any class`;

  // Resolve participant to student_id
  const studentId = await resolveParticipantToStudent(supabase, identity);
  if (!studentId) {
    // Not a student (e.g., teacher) — this is expected, skip silently
    return null;
  }

  // Record the join via raw INSERT to the attendance tables
  // We do this with the service_role client to bypass RLS
  const instituteResult = await supabase
    .from('live_classes')
    .select('institute_id')
    .eq('class_id', classId)
    .single();

  const instituteId = instituteResult?.data?.institute_id;
  if (!instituteId) return 'Could not resolve institute_id';

  const now = new Date().toISOString();

  // Check if an attendance record already exists
  const { data: existing } = await supabase
    .from('attendance')
    .select('attendance_id, join_count')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .maybeSingle();

  let attendanceId: string;

  if (existing) {
    attendanceId = existing.attendance_id;
    // Increment join_count (rejoin)
    await supabase
      .from('attendance')
      .update({
        join_count: (existing.join_count || 0) + 1,
        updated_at: now,
      })
      .eq('attendance_id', attendanceId);
  } else {
    // First join — create record with joined_at
    const { data: inserted } = await supabase
      .from('attendance')
      .insert({
        class_id: classId,
        student_id: studentId,
        institute_id: instituteId,
        joined_at: now,
        join_count: 1,
        attendance_status: 'absent',
        duration_seconds: 0,
      })
      .select('attendance_id')
      .single();

    if (!inserted) return 'Failed to create attendance record';
    attendanceId = inserted.attendance_id;
  }

  // Insert JOIN event
  await supabase
    .from('attendance_events')
    .insert({
      attendance_id: attendanceId,
      class_id: classId,
      student_id: studentId,
      institute_id: instituteId,
      event_type: 'join',
      event_timestamp: now,
    });

  structuredLog('ATTENDANCE_JOIN_RECORDED', {
    classId,
    studentId,
    attendanceId,
    isRejoin: !!existing,
    joinCount: existing ? (existing.join_count || 0) + 1 : 1,
  });

  return null; // No error
}

/**
 * Handle a participant_left event.
 *
 * Records the student's leave in the attendance system.
 */
async function handleParticipantLeft(
  supabase: ReturnType<typeof createClient>,
  payload: LiveKitWebhookPayload,
): Promise<string | null> {
  const roomName = payload.room?.name;
  const identity = payload.participant?.identity;

  if (!roomName || !identity) {
    return 'Missing room name or participant identity';
  }

  // Resolve room to class_id
  const classId = await resolveRoomToClass(supabase, roomName);
  if (!classId) return `Room ${roomName} not mapped to any class`;

  // Resolve participant to student_id
  const studentId = await resolveParticipantToStudent(supabase, identity);
  if (!studentId) {
    // Not a student — skip silently (teachers don't need attendance tracking)
    return null;
  }

  // Find the attendance record
  const { data: attendance } = await supabase
    .from('attendance')
    .select('attendance_id, duration_seconds, institute_id')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (!attendance) return 'No attendance record found for leave';

  // Find the student's last JOIN event
  const { data: lastJoin } = await supabase
    .from('attendance_events')
    .select('event_timestamp')
    .eq('attendance_id', attendance.attendance_id)
    .eq('event_type', 'join')
    .order('event_timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = new Date();
  const nowIso = now.toISOString();

  // Calculate duration increment
  let durationIncrement = 0;
  if (lastJoin?.event_timestamp) {
    durationIncrement = Math.round(
      (now.getTime() - new Date(lastJoin.event_timestamp).getTime()) / 1000
    );
    if (durationIncrement < 0) durationIncrement = 0;
  }

  // Update attendance record
  const newDuration = (attendance.duration_seconds || 0) + durationIncrement;

  await supabase
    .from('attendance')
    .update({
      left_at: nowIso,
      duration_seconds: newDuration,
      updated_at: nowIso,
    })
    .eq('attendance_id', attendance.attendance_id);

  // Insert LEAVE event
  await supabase
    .from('attendance_events')
    .insert({
      attendance_id: attendance.attendance_id,
      class_id: classId,
      student_id: studentId,
      institute_id: attendance.institute_id,
      event_type: 'leave',
      event_timestamp: nowIso,
    });

  structuredLog('ATTENDANCE_LEAVE_RECORDED', {
    classId,
    studentId,
    attendanceId: attendance.attendance_id,
    durationIncrement,
    newDuration,
  });

  return null; // No error
}

/**
 * Handle a room_finished event.
 *
 * Triggers attendance finalization for the class associated with this room.
 */
async function handleRoomFinished(
  supabase: ReturnType<typeof createClient>,
  payload: LiveKitWebhookPayload,
): Promise<string | null> {
  const roomName = payload.room?.name;
  if (!roomName) return 'Missing room name';

  const classId = await resolveRoomToClass(supabase, roomName);
  if (!classId) return `Room ${roomName} not mapped to any class`;

  // Call the database function to calculate attendance
  const { error: fnErr } = await supabase
    .rpc('calculate_class_attendance', {
      p_class_id: classId,
      p_present_threshold: 75.0,
      p_partial_threshold: 25.0,
    });

  if (fnErr) {
    structuredLog('ATTENDANCE_FINALIZE_ERROR', {
      classId,
      error: fnErr.message,
    });
    return `Failed to finalize attendance: ${fnErr.message}`;
  }

  structuredLog('ATTENDANCE_FINALIZED', {
    classId,
    source: 'room_finished_webhook',
  });

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Handler
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, processed: 0, errors: ['Method not allowed. Use POST.'] }, 405);
  }

  structuredLog('WEBHOOK_RECEIVED', {
    method: req.method,
    contentType: req.headers.get('content-type'),
  });

  try {
    // ══════════════════════════════════════════════════════════════════
    // Step 1: Read raw body (must be read BEFORE verification because
    //          WebhookReceiver.receive() requires the unparsed body and
    //          the body stream can only be consumed once.)
    // ══════════════════════════════════════════════════════════════════
    const rawBody = await req.text();

    // ── Debug: log all incoming headers ──────────────────────────────
    console.log("===== ALL REQUEST HEADERS =====");
    console.log(Object.fromEntries(req.headers.entries()));
    console.log("===============================");

    // ══════════════════════════════════════════════════════════════════
    // Step 2: Verify webhook signature via WebhookReceiver
    //
    // LiveKit Cloud sends the webhook JWT in the Authorization header.
    // We use the official livekit-server-sdk WebhookReceiver to verify
    // the JWT signature using LIVEKIT_API_KEY and LIVEKIT_API_SECRET.
    //
    // If API credentials are not configured, verification is skipped
    // (useful for local development / testing).
    // ══════════════════════════════════════════════════════════════════
    const apiKey = Deno.env.get('LIVEKIT_API_KEY');
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
    const authHeader = req.headers.get('Authorization');

    let verifiedPayload: LiveKitWebhookPayload | null = null;

    if (apiKey && apiSecret && authHeader) {
      try {
        const verified = await verifyWebhook(rawBody, authHeader, apiKey, apiSecret);
        verifiedPayload = verified as LiveKitWebhookPayload;
        structuredLog('SIGNATURE_VERIFIED', {
          hasKey: !!apiKey,
          hasSecret: !!apiSecret,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown verification error';
        structuredLog('SIGNATURE_VERIFICATION_FAILED', {
          error: message,
          hasAuthHeader: !!authHeader,
        });
        return jsonResponse(
          {
            success: false,
            processed: 0,
            errors: [`Webhook signature verification failed: ${message}`],
          },
          401,
        );
      }
    } else {
      const missing: string[] = [];
      if (!apiKey) missing.push('LIVEKIT_API_KEY');
      if (!apiSecret) missing.push('LIVEKIT_API_SECRET');
      if (!authHeader) missing.push('Authorization header');

      structuredLog('SIGNATURE_SKIPPED', {
        hint: `Missing: ${missing.join(', ')} — verification disabled`,
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Create Supabase client
    // ══════════════════════════════════════════════════════════════════
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse(
        { success: false, processed: 0, errors: ['Server configuration error'] },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Parse payload
    //
    // If verification succeeded, use the already-parsed verifiedPayload.
    // Otherwise, fall back to manual JSON parse (local dev / testing).
    // ══════════════════════════════════════════════════════════════════
    let payload: LiveKitWebhookPayload;
    try {
      payload = verifiedPayload ?? (JSON.parse(rawBody) as LiveKitWebhookPayload);
    } catch {
      return jsonResponse(
        { success: false, processed: 0, errors: ['Invalid JSON payload'] },
        400,
      );
    }

    structuredLog('EVENT_PROCESSING', {
      event: payload.event,
      room: payload.room?.name,
      participant: payload.participant?.identity,
      eventId: payload.id,
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 5: Route event to handler
    // ══════════════════════════════════════════════════════════════════
    const errors: string[] = [];

    switch (payload.event) {
      case 'participant_joined': {
        const err = await handleParticipantJoined(supabase, payload);
        if (err) errors.push(err);
        break;
      }
      case 'participant_left': {
        const err = await handleParticipantLeft(supabase, payload);
        if (err) errors.push(err);
        break;
      }
      case 'room_finished': {
        const err = await handleRoomFinished(supabase, payload);
        if (err) errors.push(err);
        break;
      }
      default:
        structuredLog('EVENT_SKIPPED', {
          event: payload.event,
          reason: 'Unhandled event type',
        });
        // Return success for unhandled events (LiveKit expects 200)
        return jsonResponse({ success: true, processed: 0, errors: [] });
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 6: Return response
    // ══════════════════════════════════════════════════════════════════
    const processed = payload.event === 'participant_joined' || payload.event === 'participant_left' || payload.event === 'room_finished' ? 1 : 0;

    structuredLog('WEBHOOK_COMPLETE', {
      event: payload.event,
      processed,
      errors: errors.length > 0 ? errors : undefined,
    });

    if (errors.length > 0) {
      return jsonResponse({ success: true, processed, errors }, 200);
    }

    return jsonResponse({ success: true, processed, errors: [] }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('WEBHOOK_ERROR', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return jsonResponse(
      { success: false, processed: 0, errors: [message] },
      500,
    );
  }
});
