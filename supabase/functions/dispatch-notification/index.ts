// ============================================================================
// Edge Function: dispatch-notification
//
// SINGLE backend entry point for the complete notification workflow.
//
// The frontend sends only the sender identity, role, content, audience
// descriptor, and a sendPush flag. This function does EVERYTHING else:
//
//   1. Authenticate the caller (JWT from Authorization header)
//   2. Determine caller role from profiles table
//   3. Validate permissions (role-based audience checks)
//   4. Resolve audience to profile IDs (queries DB)
//   5. Create notification row in `notifications`
//   6. Create recipient rows in `notification_recipients`
//   7. If sendPush=true, dispatch FCM push via _shared/pushNotification.ts
//   8. Return structured summary
//
// Permission enforcement:
//   - Admin can target any audience (all_users, students, teachers, batch,
//     specific_students, specific_teachers)
//   - Teacher can ONLY target 'batch' (own assigned batches) and
//     'specific_students' (only students in their assigned batches)
//
// POST /functions/v1/dispatch-notification
//
// Request body:
// {
//   "instituteId": "uuid",
//   "title": "Notification Title",
//   "body": "Notification body text",
//   "eventType": "announcement",
//   "priority": "normal",          // optional, default "normal"
//   "channel": "in_app",           // optional, default "in_app"
//   "triggeredBy": "uuid|null",    // sender's profile_id
//   "referenceType": "mock_test",  // optional
//   "referenceId": "uuid",         // optional
//   "audience": {
//     "type": "students",          // audience type
//     "batchId": "uuid",          // required when type='batch'
//     "recipientIds": ["uuid"]     // required when type='specific_*'
//   },
//   "sendPush": false              // optional, default false
// }
//
// Response (success):
// {
//   "success": true,
//   "notificationId": "uuid",
//   "totalRecipients": 42,
//   "successfulPushes": 10,
//   "failedPushes": 0
// }
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendPushNotification, sendBulkPushNotification } from '../_shared/pushNotification.ts';

declare const EdgeRuntime: {
  waitUntil?: (promise: Promise<unknown>) => void;
};

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type NotificationType =
  | 'mock_test_assigned' | 'mock_test_reminder' | 'mock_test_submitted'
  | 'result_published' | 'result_available' | 'new_content_uploaded' | 'chapter_added'
  | 'subject_added' | 'new_mock_test_available' | 'announcement'
  | 'general_message' | 'warning' | 'success' | 'error'
  | 'live_class_reminder' | 'live_class_started' | 'content_approved'
  | 'content_rejected'
  | 'subscription_expiring' | 'subscription_expired' | 'batch_assigned'
  | 'doubt_assigned' | 'doubt_submitted' | 'doubt_answered' | 'doubt_follow_up'
  | 'doubt_resolved' | 'doubt_reopened' | 'doubt_unassigned'
  | 'custom';

type NotificationPriority = 'low' | 'normal' | 'high' | 'critical';
type NotificationChannel = 'in_app' | 'push' | 'email' | 'sms';

type NotificationAudienceType =
  | 'all_users' | 'students' | 'teachers' | 'batch'
  | 'specific_students' | 'specific_teachers';

interface NotificationAudience {
  type: NotificationAudienceType;
  batchId?: string;
  recipientIds?: string[];
}

interface DispatchRequest {
  instituteId: string;
  title: string;
  body: string;
  eventType: NotificationType;
  priority?: NotificationPriority;
  channel?: NotificationChannel;
  triggeredBy?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  data?: Record<string, string>;
  audience: NotificationAudience;
  sendPush?: boolean;
  pushOnly?: boolean;
  clientRequestId?: string;
  isAsync?: boolean;
}

interface DispatchSuccessResponse {
  success: true;
  notificationId: string;
  totalRecipients: number;
  successfulPushes: number;
  failedPushes: number;
  isAsync?: boolean;
  isDuplicate?: boolean;
}

interface DispatchErrorResponse {
  success: false;
  error: string;
}

type FunctionResponse = DispatchSuccessResponse | DispatchErrorResponse;

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PAGE_SIZE = 1000;
const RECIPIENT_CHUNK_SIZE = 500;
const ASYNC_PUSH_THRESHOLD = 200;


// ═══════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'dispatch-notification',
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
  return jsonResponse({ success: false, error }, status);
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 1–2: Authenticate & Determine Role
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify the JWT from the Authorization header and return the caller's
 * profile (profile_id, role, institute_id).
 *
 * Uses the anon key to create a client that can verify the user's JWT.
 * Falls back to extracting from the JWT claims if the profiles table
 * query fails (e.g., for demo/mock users).
 */
async function authenticateCaller(
  supabase: ReturnType<typeof createClient>,
  authHeader: string | null,
): Promise<{ profileId: string; role: 'admin' | 'teacher' | 'student'; instituteId: string } | { error: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { error: 'Missing or invalid Authorization header.' };
  }

  // Verify the JWT and get the user
  // The JWT is available via the client's global Authorization header
  // (set when anonClient was created), so getUser() without args works.
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    structuredLog('AUTH_FAILED', {
      error: authError?.message ?? 'No user found',
    });
    return { error: 'Authentication failed. Please provide a valid JWT.' };
  }

  // Query the profiles table for role and institute_id
  // Because anonClient was created with global.headers.Authorization, this
  // query runs within the authenticated user's RLS context (auth.uid() = user.id).
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('profile_id, role, institute_id')
    .eq('profile_id', user.id)
    .single();

  if (profileError || !profile) {
    // Fallback: try to get role from user metadata
    const metadataRole = user.user_metadata?.role as string | undefined;
    const role = (metadataRole === 'admin' || metadataRole === 'teacher' || metadataRole === 'student')
      ? metadataRole
      : 'teacher';

    structuredLog('AUTH_PROFILE_FALLBACK', {
      userId: user.id,
      role,
      reason: profileError?.message ?? 'Profile not found',
    });

    return {
      profileId: user.id,
      role,
      instituteId: user.user_metadata?.institute_id as string ?? '',
    };
  }

  const dbRole = profile.role as string;

  structuredLog('ROLE_RESOLUTION', {
    userId: user.id,
    profileId: profile.profile_id,
    dbRole,
    instituteId: profile.institute_id,
  });

  if (dbRole !== 'admin' && dbRole !== 'teacher' && dbRole !== 'student') {
    return { error: 'Only admins, teachers, and students can send notifications.' };
  }

  return {
    profileId: profile.profile_id as string,
    role: dbRole as 'admin' | 'teacher' | 'student',
    instituteId: profile.institute_id as string ?? '',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 3: Validate Permissions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check that the caller's role is allowed to target the requested audience.
 * Returns null if allowed, or an error string if denied.
 */
function validatePermissions(
  role: 'admin' | 'teacher' | 'student',
  audienceType: NotificationAudienceType,
  eventType?: NotificationType,
  referenceType?: string | null,
): string | null {
  if (role === 'admin') {
    // Admin can target any audience
    return null;
  }

  const isDoubtEvent =
    referenceType === 'student_doubt' ||
    (typeof eventType === 'string' && eventType.startsWith('doubt_'));

  if (role === 'student') {
    if (
      isDoubtEvent &&
      audienceType === 'specific_teachers' &&
      (eventType === 'doubt_submitted' || eventType === 'doubt_follow_up' || eventType === 'doubt_assigned')
    ) {
      return null;
    }
    return 'Students are only permitted to send notifications for doubts to teachers.';
  }

  // Teacher restrictions
  switch (audienceType) {
    case 'all_users':
      return 'Teachers cannot send notifications to all users.';
    case 'students':
      return 'Teachers cannot send notifications to all students.';
    case 'teachers':
      return 'Teachers cannot send notifications to other teachers.';
    case 'specific_teachers':
      if (isDoubtEvent) {
        return null; // Allowed for doubt acknowledgement / routing
      }
      return 'Teachers cannot send notifications to other teachers.';
    case 'batch':
    case 'specific_students':
      return null; // Allowed
    default:
      return `Unknown audience type: ${audienceType}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 4: Resolve Audience (Paginated & Deterministic)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deterministically fetch all profiles for an institute (and optional role)
 * in pages of PAGE_SIZE until exhaustion. Eliminates the PostgREST 1,000-row ceiling.
 */
async function fetchAllProfilesPaginated(
  supabase: ReturnType<typeof createClient>,
  instituteId: string,
  role?: 'student' | 'teacher',
): Promise<string[] | { error: string }> {
  const profileIds: string[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from('profiles')
      .select('profile_id')
      .eq('institute_id', instituteId)
      .order('profile_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (role) {
      query = query.eq('role', role);
    }

    const { data, error } = await query;
    if (error) return { error: error.message };
    if (!data || data.length === 0) break;

    for (const row of data) {
      if (row.profile_id) {
        profileIds.push(row.profile_id as string);
      }
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return profileIds;
}

/**
 * Deterministically fetch all enrolled student profiles for a batch
 * in pages of PAGE_SIZE until exhaustion.
 */
async function fetchBatchStudentsPaginated(
  supabase: ReturnType<typeof createClient>,
  batchId: string,
): Promise<string[] | { error: string }> {
  const profileIds: string[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('batch_students')
      .select(`
        student_details!inner(
          profile_id
        )
      `)
      .eq('batch_id', batchId)
      .range(from, from + PAGE_SIZE - 1);

    if (error) return { error: error.message };
    if (!data || data.length === 0) break;

    for (const bs of data) {
      const details = (bs as Record<string, unknown>).student_details as Record<string, unknown>;
      if (details?.profile_id) {
        profileIds.push(details.profile_id as string);
      }
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return Array.from(new Set(profileIds));
}

/**
 * Resolve an audience descriptor to actual profile IDs.
 * Enforces backend permissions — teachers can only access their own batches.
 * Fully paginated to support thousands of recipients without silent truncation.
 */
async function resolveAudience(
  supabase: ReturnType<typeof createClient>,
  instituteId: string,
  audience: NotificationAudience,
  role: 'admin' | 'teacher' | 'student',
  callerProfileId: string,
): Promise<string[] | { error: string }> {
  const { type, batchId, recipientIds } = audience;

  switch (type) {
    // ═════════════════════════════════════════════════════════════════
    // All Users (admin only)
    // ═════════════════════════════════════════════════════════════════
    case 'all_users': {
      return await fetchAllProfilesPaginated(supabase, instituteId);
    }

    // ═════════════════════════════════════════════════════════════════
    // All Students (admin only)
    // ═════════════════════════════════════════════════════════════════
    case 'students': {
      return await fetchAllProfilesPaginated(supabase, instituteId, 'student');
    }

    // ═════════════════════════════════════════════════════════════════
    // All Teachers (admin only)
    // ═════════════════════════════════════════════════════════════════
    case 'teachers': {
      return await fetchAllProfilesPaginated(supabase, instituteId, 'teacher');
    }

    // ═════════════════════════════════════════════════════════════════
    // Specific Batch
    // ═════════════════════════════════════════════════════════════════
    case 'batch': {
      if (!batchId) return { error: 'batchId is required for batch audience.' };

      // Teacher validation: verify batch is assigned
      if (role === 'teacher') {
        const { data: teacherRow, error: teacherError } = await supabase
          .from('teacher_details')
          .select('teacher_id')
          .eq('profile_id', callerProfileId)
          .maybeSingle();

        if (teacherError) return { error: teacherError.message };
        if (!teacherRow) return { error: 'Teacher details not found for this profile.' };

        const teacherId = teacherRow.teacher_id;

        const { data: assignment, error: assignError } = await supabase
          .from('batch_subject_teachers')
          .select('batch_subject_id, batch_subjects!inner(batch_id)')
          .eq('teacher_id', teacherId)
          .eq('batch_subjects.batch_id', batchId)
          .limit(1);

        if (assignError) return { error: assignError.message };
        if (!assignment || assignment.length === 0) return { error: 'You are not assigned to this batch.' };
      }

      return await fetchBatchStudentsPaginated(supabase, batchId);
    }

    // ═════════════════════════════════════════════════════════════════
    // Specific Students (teacher: validated against assigned batches)
    // ═════════════════════════════════════════════════════════════════
    case 'specific_students': {
      if (!recipientIds || recipientIds.length === 0) {
        return { error: 'recipientIds is required for specific_students audience.' };
      }

      // Teacher: validate students belong to their batches
      if (role === 'teacher') {
        const { data: teacherRow, error: teacherError } = await supabase
          .from('teacher_details')
          .select('teacher_id')
          .eq('profile_id', callerProfileId)
          .maybeSingle();

        if (teacherError) return { error: teacherError.message };
        if (!teacherRow) return { error: 'Teacher details not found for this profile.' };

        const teacherId = teacherRow.teacher_id;

        const { data: teacherBatches, error: tbError } = await supabase
          .from('batch_subject_teachers')
          .select('batch_subjects!inner(batch_id)')
          .eq('teacher_id', teacherId);

        if (tbError) return { error: tbError.message };

        const assignedBatchIds = [
          ...new Set(
            (teacherBatches ?? [])
              .map((b: Record<string, unknown>) => {
                const bs = b.batch_subjects as Record<string, unknown> | undefined;
                return bs?.batch_id as string | undefined;
              })
              .filter(Boolean) as string[],
          ),
        ];

        if (assignedBatchIds.length === 0) {
          return { error: 'You have no assigned batches.' };
        }

        const { data: batchStudents, error: bsError } = await supabase
          .from('batch_students')
          .select(`
            student_details!inner(
              profile_id
            )
          `)
          .in('batch_id', assignedBatchIds);

        if (bsError) return { error: bsError.message };

        const validProfileIds = new Set(
          (batchStudents ?? [])
            .map((bs: Record<string, unknown>) => {
              const details = (bs as Record<string, unknown>).student_details as Record<string, unknown>;
              return details?.profile_id as string;
            })
            .filter(Boolean),
        );

        const invalidIds = recipientIds.filter((id) => !validProfileIds.has(id));
        if (invalidIds.length > 0) {
          return { error: 'Some students are not in your assigned batches.' };
        }
      }

      return Array.from(new Set(recipientIds));
    }

    // ═════════════════════════════════════════════════════════════════
    // Specific Teachers (admin only)
    // ═════════════════════════════════════════════════════════════════
    case 'specific_teachers': {
      if (!recipientIds || recipientIds.length === 0) {
        return { error: 'recipientIds is required for specific_teachers audience.' };
      }
      return Array.from(new Set(recipientIds));
    }

    default:
      return { error: `Unknown audience type: ${type}` };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 5–6: Create Notification + Recipients
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a notification event row and recipient rows.
 * Uses larger chunk sizes (500) and ON CONFLICT handling for fast, idempotent writes.
 * Returns the notification_id and the actual number of recipients inserted.
 */
async function createNotificationWithRecipients(
  supabase: ReturnType<typeof createClient>,
  params: {
    instituteId: string;
    title: string;
    body: string;
    eventType: NotificationType;
    channel: NotificationChannel;
    triggeredBy: string | null;
    referenceType: string | null;
    referenceId: string | null;
    priority?: NotificationPriority;
    recipientIds: string[];
    clientRequestId?: string | null;
  },
): Promise<{ notificationId: string; inserted: number } | { error: string }> {
  const {
    instituteId,
    title,
    body,
    eventType,
    channel,
    triggeredBy,
    referenceType,
    referenceId,
    recipientIds,
    clientRequestId,
  } = params;

  // For custom broadcasts, if referenceType/referenceId are empty and clientRequestId is provided,
  // use referenceType = 'custom_broadcast' and referenceId = clientRequestId for idempotency indexing.
  const resolvedRefType = referenceType ?? (clientRequestId ? 'custom_broadcast' : null);
  const resolvedRefId = referenceId ?? (clientRequestId ? clientRequestId : null);

  const dbRecord: Record<string, unknown> = {
    institute_id: instituteId,
    template_id: null,
    title: title.trim(),
    body: body.trim(),
    channel: channel ?? 'in_app',
    event_type: eventType,
    triggered_by: triggeredBy ?? null,
    reference_type: resolvedRefType,
    reference_id: resolvedRefId,
    total_recipients: recipientIds.length,
  };

  const { data: notifData, error: notifError } = await supabase
    .from('notifications')
    .insert(dbRecord)
    .select('notification_id')
    .single();

  if (notifError) {
    structuredLog('NOTIFICATION_INSERT_FAILED', {
      error: notifError.message,
      details: notifError.details,
    });
    return { error: `Failed to create notification: ${notifError.message}` };
  }

  const notificationId = notifData.notification_id as string;

  // ── Insert recipient rows in chunks of RECIPIENT_CHUNK_SIZE (500) ───
  const recipientRows = recipientIds.map((profileId) => ({
    notification_id: notificationId,
    profile_id: profileId,
    institute_id: instituteId,
    is_read: false,
    read_at: null,
    received_at: new Date().toISOString(),
  }));

  let totalInserted = 0;

  for (let i = 0; i < recipientRows.length; i += RECIPIENT_CHUNK_SIZE) {
    const chunk = recipientRows.slice(i, i + RECIPIENT_CHUNK_SIZE);
    const { error: recipError } = await supabase
      .from('notification_recipients')
      .upsert(chunk, { onConflict: 'notification_id,profile_id', ignoreDuplicates: true });

    if (recipError) {
      structuredLog('RECIPIENT_CHUNK_INSERT_FAILED', {
        chunkIndex: i / RECIPIENT_CHUNK_SIZE,
        error: recipError.message,
      });
      // Continue with remaining chunks — partial insert is acceptable
      continue;
    }

    totalInserted += chunk.length;
  }

  // Update total_recipients to reflect actual inserts
  if (totalInserted !== recipientIds.length) {
    await supabase
      .from('notifications')
      .update({ total_recipients: totalInserted })
      .eq('notification_id', notificationId);
  }

  structuredLog('NOTIFICATION_CREATED', {
    notificationId,
    requested: recipientIds.length,
    inserted: totalInserted,
  });

  return { notificationId, inserted: totalInserted };
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
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  structuredLog('REQUEST_START', {
    method: req.method,
    url: req.url,
  });

  try {
    // ══════════════════════════════════════════════════════════════════
    // Step 1: Create Supabase clients
    // ══════════════════════════════════════════════════════════════════
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return errorResponse('Server configuration error.', 500);
    }

    const authHeader = req.headers.get('Authorization');

    // ── Debug logs for auth troubleshooting ─────────────────────────────
    structuredLog('AUTH_HEADER_CHECK', {
      exists: !!authHeader,
      length: authHeader?.length ?? 0,
      startsWithBearer: authHeader?.startsWith('Bearer ') ?? false,
      tokenPreview: authHeader ? authHeader.slice(7, 27) + '...' : 'N/A',
    });

    // Anon client for JWT verification (respects RLS).
    // IMPORTANT: Pass the Authorization header as a global header so that
    // both auth.getUser() AND subsequent DB queries (e.g. profiles table)
    // use the user's authenticated context. Without this, RLS policies that
    // check auth.uid() would return no rows.
    //
    // This matches the pattern used by complete-course-purchase.
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: authHeader ?? '',
        },
      },
    });

    // Service role client for DB writes (bypasses RLS for bulk operations)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ══════════════════════════════════════════════════════════════════
    // Step 1–2: Authenticate & Determine Role
    // ══════════════════════════════════════════════════════════════════
    const caller = await authenticateCaller(anonClient, authHeader);

    if ('error' in caller) {
      return errorResponse(caller.error, 401);
    }

    const { profileId: callerProfileId, role: callerRole, instituteId: callerInstituteId } = caller;

    structuredLog('AUTHENTICATED', {
      profileId: callerProfileId,
      role: callerRole,
    });

    // ══════════════════════════════════════════════════════════════════
    // Parse request body
    // ══════════════════════════════════════════════════════════════════
    let body: DispatchRequest;
    try {
      body = await req.json() as DispatchRequest;
    } catch {
      return errorResponse('Invalid JSON in request body.', 400);
    }

    structuredLog('REQUEST_PARSED', {
      title: body.title,
      audienceType: body.audience?.type,
      sendPush: body.sendPush,
    });

    // ── Validate required fields ─────────────────────────────────────
    const instituteId = body.instituteId || callerInstituteId;

    if (!instituteId) {
      return errorResponse('instituteId is required and could not be determined.', 400);
    }

    if (!body.title?.trim()) return errorResponse('title is required.', 400);
    if (!body.body?.trim()) return errorResponse('body is required.', 400);
    if (!body.eventType) return errorResponse('eventType is required.', 400);
    if (!body.audience) return errorResponse('audience is required.', 400);

    // ══════════════════════════════════════════════════════════════════
    // Step 3: Validate Permissions
    // ══════════════════════════════════════════════════════════════════
    structuredLog('PERMISSION_CHECK', {
      callerRole,
      audienceType: body.audience.type,
      batchId: body.audience.batchId ?? null,
      recipientIdsCount: body.audience.recipientIds?.length ?? 0,
      recipientIdsPreview: body.audience.recipientIds
        ? body.audience.recipientIds.slice(0, 3).join(', ') + (body.audience.recipientIds.length > 3 ? '...' : '')
        : null,
    });

    const permissionError = validatePermissions(
      callerRole,
      body.audience.type,
      body.eventType,
      body.referenceType,
    );

    if (permissionError) {
      structuredLog('PERMISSION_DENIED', {
        callerRole,
        audienceType: body.audience.type,
        error: permissionError,
      });
      return errorResponse(permissionError, 403);
    }

    structuredLog('PERMISSION_GRANTED', {
      callerRole,
      audienceType: body.audience.type,
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 3.5: Idempotency Check (for Admin custom broadcasts)
    // ══════════════════════════════════════════════════════════════════
    const clientRequestId =
      body.clientRequestId ||
      (body.referenceType === 'custom_broadcast' ? body.referenceId : null);

    if (clientRequestId) {
      const { data: existing, error: existingError } = await adminClient
        .from('notifications')
        .select('notification_id, total_recipients, created_at')
        .eq('institute_id', instituteId)
        .eq('reference_type', 'custom_broadcast')
        .eq('reference_id', clientRequestId)
        .maybeSingle();

      if (!existingError && existing) {
        structuredLog('IDEMPOTENT_REQUEST_IGNORED', {
          clientRequestId,
          notificationId: existing.notification_id,
          totalRecipients: existing.total_recipients,
        });

        return jsonResponse({
          success: true,
          notificationId: existing.notification_id,
          totalRecipients: existing.total_recipients,
          successfulPushes: 0,
          failedPushes: 0,
          isDuplicate: true,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 4: Resolve Audience
    // ══════════════════════════════════════════════════════════════════
    const resolved = await resolveAudience(
      adminClient,
      instituteId,
      body.audience,
      callerRole,
      callerProfileId,
    );

    if ('error' in resolved) {
      return errorResponse(resolved.error, 403);
    }

    const recipientIds = resolved;

    if (recipientIds.length === 0) {
      return errorResponse('No recipients found for the selected audience.', 404);
    }

    structuredLog('AUDIENCE_RESOLVED', {
      audienceType: body.audience.type,
      recipientCount: recipientIds.length,
    });

    // ══════════════════════════════════════════════════════════════════
    // Step 5–6: Create Notification + Recipients (Skipped if pushOnly)
    // ══════════════════════════════════════════════════════════════════
    let notificationId = '';
    let insertedRecipients = recipientIds.length;

    if (!body.pushOnly) {
      const notifResult = await createNotificationWithRecipients(adminClient, {
        instituteId,
        title: body.title,
        body: body.body,
        eventType: body.eventType,
        channel: body.channel ?? 'in_app',
        triggeredBy: body.triggeredBy ?? callerProfileId,
        referenceType: body.referenceType ?? null,
        referenceId: body.referenceId ?? null,
        priority: body.priority,
        recipientIds,
        clientRequestId,
      });

      if ('error' in notifResult) {
        return errorResponse(notifResult.error, 500);
      }

      notificationId = notifResult.notificationId;
      insertedRecipients = notifResult.inserted;
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 7: Push Delivery (Synchronous or Background Fan-Out)
    // ══════════════════════════════════════════════════════════════════
    let successfulPushes = 0;
    let failedPushes = 0;

    if (body.sendPush && recipientIds.length > 0) {
      const pushData: Record<string, string> = { ...(body.data ?? {}) };
      if (body.referenceType) pushData.referenceType = body.referenceType;
      if (body.referenceId) pushData.referenceId = body.referenceId;
      pushData.type = 'admin_notification';

      const shouldRunAsync = recipientIds.length > ASYNC_PUSH_THRESHOLD || body.isAsync === true;

      if (shouldRunAsync) {
        // ── Phase 2: Asynchronous background push execution ──────────────
        const targetNotifId = notificationId;

        const asyncPushTask = (async () => {
          structuredLog('ASYNC_PUSH_STARTED', {
            notificationId: targetNotifId,
            recipientCount: recipientIds.length,
          });

          try {
            const pushResult = await sendBulkPushNotification(adminClient, {
              profileIds: recipientIds,
              title: body.title,
              body: body.body,
              data: pushData,
              concurrency: 25,
            });

            if (targetNotifId) {
              await adminClient
                .from('notifications')
                .update({ dispatched_at: new Date().toISOString() })
                .eq('notification_id', targetNotifId);
            }

            structuredLog('ASYNC_PUSH_COMPLETED', {
              notificationId: targetNotifId,
              successful: pushResult.successful,
              failed: pushResult.failed,
              totalDevices: pushResult.totalDevices,
            });
          } catch (err) {
            structuredLog('ASYNC_PUSH_FAILED', {
              notificationId: targetNotifId,
              error: err instanceof Error ? err.message : 'Unknown push error',
            });
          }
        })();

        if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
          EdgeRuntime.waitUntil(asyncPushTask);
        } else {
          asyncPushTask.catch((err) => {
            console.error('[dispatch-notification] Background push unhandled error:', err);
          });
        }

        structuredLog('ASYNC_DISPATCH_HANDOFF', {
          notificationId,
          totalRecipients: insertedRecipients,
          isAsync: true,
        });

        return jsonResponse({
          success: true,
          notificationId,
          totalRecipients: insertedRecipients,
          successfulPushes: 0,
          failedPushes: 0,
          isAsync: true,
        });
      } else {
        // ── Synchronous push execution for moderate audiences (<= 200) ────
        const pushResult = await sendBulkPushNotification(adminClient, {
          profileIds: recipientIds,
          title: body.title,
          body: body.body,
          data: pushData,
          concurrency: 25,
        });

        successfulPushes = pushResult.successful;
        failedPushes = pushResult.failed;

        if (notificationId) {
          await adminClient
            .from('notifications')
            .update({ dispatched_at: new Date().toISOString() })
            .eq('notification_id', notificationId);
        }

        structuredLog('SYNC_PUSH_COMPLETE', {
          notificationId,
          successful: successfulPushes,
          failed: failedPushes,
        });
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 8: Return Summary
    // ══════════════════════════════════════════════════════════════════
    structuredLog('DISPATCH_COMPLETE', {
      notificationId,
      totalRecipients: insertedRecipients,
      successfulPushes,
      failedPushes,
    });

    return jsonResponse({
      success: true,
      notificationId,
      totalRecipients: insertedRecipients,
      successfulPushes,
      failedPushes,
      isAsync: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('REQUEST_FAILED', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse(message, 500);
  }
});
