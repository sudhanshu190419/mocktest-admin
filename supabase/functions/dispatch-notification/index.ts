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
import { sendPushNotification } from '../_shared/pushNotification.ts';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

type NotificationType =
  | 'mock_test_assigned' | 'mock_test_reminder' | 'mock_test_submitted'
  | 'result_published' | 'new_content_uploaded' | 'chapter_added'
  | 'subject_added' | 'new_mock_test_available' | 'announcement'
  | 'general_message' | 'warning' | 'success' | 'error'
  | 'live_class_reminder' | 'content_approved' | 'content_rejected'
  | 'subscription_expiring' | 'subscription_expired' | 'batch_assigned'
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
  audience: NotificationAudience;
  sendPush?: boolean;
}

interface DispatchSuccessResponse {
  success: true;
  notificationId: string;
  totalRecipients: number;
  successfulPushes: number;
  failedPushes: number;
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

const CHUNK_SIZE = 100;

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
): Promise<{ profileId: string; role: 'admin' | 'teacher'; instituteId: string } | { error: string }> {
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
    const role = metadataRole === 'admin' ? 'admin' : 'teacher';

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

  // Determine role — only 'admin' or 'teacher' can send notifications
  const dbRole = profile.role as string;

  structuredLog('ROLE_RESOLUTION', {
    userId: user.id,
    profileId: profile.profile_id,
    dbRole,
    instituteId: profile.institute_id,
  });

  if (dbRole !== 'admin' && dbRole !== 'teacher') {
    return { error: 'Only admins and teachers can send notifications.' };
  }

  return {
    profileId: profile.profile_id as string,
    role: dbRole as 'admin' | 'teacher',
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
  role: 'admin' | 'teacher',
  audienceType: NotificationAudienceType,
): string | null {
  if (role === 'admin') {
    // Admin can target any audience
    return null;
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
      return 'Teachers cannot send notifications to other teachers.';
    case 'batch':
    case 'specific_students':
      return null; // Allowed
    default:
      return `Unknown audience type: ${audienceType}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Step 4: Resolve Audience
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve an audience descriptor to actual profile IDs.
 * Enforces backend permissions — teachers can only access their own batches.
 */
async function resolveAudience(
  supabase: ReturnType<typeof createClient>,
  instituteId: string,
  audience: NotificationAudience,
  role: 'admin' | 'teacher',
  callerProfileId: string,
): Promise<string[] | { error: string }> {
  const { type, batchId, recipientIds } = audience;

  switch (type) {
    // ═════════════════════════════════════════════════════════════════
    // All Users (admin only)
    // ═════════════════════════════════════════════════════════════════
    case 'all_users': {
      const { data, error } = await supabase
        .from('profiles')
        .select('profile_id')
        .eq('institute_id', instituteId);

      if (error) return { error: error.message };
      return (data ?? []).map((p: Record<string, unknown>) => p.profile_id as string);
    }

    // ═════════════════════════════════════════════════════════════════
    // All Students (admin only)
    // ═════════════════════════════════════════════════════════════════
    case 'students': {
      const { data, error } = await supabase
        .from('profiles')
        .select('profile_id')
        .eq('institute_id', instituteId)
        .eq('role', 'student');

      if (error) return { error: error.message };
      return (data ?? []).map((p: Record<string, unknown>) => p.profile_id as string);
    }

    // ═════════════════════════════════════════════════════════════════
    // All Teachers (admin only)
    // ═════════════════════════════════════════════════════════════════
    case 'teachers': {
      const { data, error } = await supabase
        .from('profiles')
        .select('profile_id')
        .eq('institute_id', instituteId)
        .eq('role', 'teacher');

      if (error) return { error: error.message };
      return (data ?? []).map((p: Record<string, unknown>) => p.profile_id as string);
    }

    // ═════════════════════════════════════════════════════════════════
    // Specific Batch
    // ═════════════════════════════════════════════════════════════════
    case 'batch': {
      if (!batchId) return { error: 'batchId is required for batch audience.' };

      // Teacher validation: verify batch is assigned
      if (role === 'teacher') {
        const { data: assignment, error: assignError } = await supabase
          .from('batch_teachers')
          .select('batch_id')
          .eq('teacher_id', callerProfileId)
          .eq('batch_id', batchId)
          .maybeSingle();

        if (assignError) return { error: assignError.message };
        if (!assignment) return { error: 'You are not assigned to this batch.' };
      }

      // Get students enrolled in this batch via student_details join
      const { data: batchStudents, error: batchError } = await supabase
        .from('batch_students')
        .select(`
          student_details!inner(
            profile_id
          )
        `)
        .eq('batch_id', batchId);

      if (batchError) return { error: batchError.message };
      return (batchStudents ?? [])
        .map((bs: Record<string, unknown>) => {
          const details = (bs as Record<string, unknown>).student_details as Record<string, unknown>;
          return details?.profile_id as string;
        })
        .filter(Boolean);
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
        const { data: teacherBatches, error: tbError } = await supabase
          .from('batch_teachers')
          .select('batch_id')
          .eq('teacher_id', callerProfileId);

        if (tbError) return { error: tbError.message };

        const assignedBatchIds = (teacherBatches ?? []).map(
          (b: Record<string, unknown>) => b.batch_id as string,
        );

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

      return recipientIds;
    }

    // ═════════════════════════════════════════════════════════════════
    // Specific Teachers (admin only)
    // ═════════════════════════════════════════════════════════════════
    case 'specific_teachers': {
      if (!recipientIds || recipientIds.length === 0) {
        return { error: 'recipientIds is required for specific_teachers audience.' };
      }
      return recipientIds;
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
 *
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
  } = params;

  // ── Create notification event row ─────────────────────────────────
  // NOTE: dispatched_at is intentionally NOT set here.
  // The column has default null, and the check constraint
  //   ck_notifications_dispatched_at (dispatched_at is null or dispatched_at >= created_at)
  // requires dispatched_at >= created_at. Setting a JavaScript-generated
  // timestamp would violate this because created_at is set by PostgreSQL
  // via default now() and runs AFTER the JavaScript timestamp is generated.
  //
  // This matches the pattern used by complete-course-purchase and
  // complete-pyq-purchase (see their createCommerceNotification functions).
  const dbRecord: Record<string, unknown> = {
    institute_id: instituteId,
    template_id: null,
    title: title.trim(),
    body: body.trim(),
    channel: channel ?? 'in_app',
    event_type: eventType,
    triggered_by: triggeredBy ?? null,
    reference_type: referenceType ?? null,
    reference_id: referenceId ?? null,
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

  // ── Insert recipient rows in chunks ───────────────────────────────
  const recipientRows = recipientIds.map((profileId) => ({
    notification_id: notificationId,
    profile_id: profileId,
    institute_id: instituteId,
    is_read: false,
    read_at: null,
    received_at: new Date().toISOString(),
  }));

  let totalInserted = 0;

  for (let i = 0; i < recipientRows.length; i += CHUNK_SIZE) {
    const chunk = recipientRows.slice(i, i + CHUNK_SIZE);
    const { error: recipError } = await supabase
      .from('notification_recipients')
      .insert(chunk);

    if (recipError) {
      structuredLog('RECIPIENT_CHUNK_INSERT_FAILED', {
        chunkIndex: i / CHUNK_SIZE,
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
// Step 7: Send Push Notifications
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dispatch push notifications to all recipients via FCM.
 *
 * Uses the existing _shared/pushNotification.ts infrastructure.
 * Errors are caught and counted — never thrown.
 */
async function dispatchPushToRecipients(
  supabase: ReturnType<typeof createClient>,
  recipientIds: string[],
  title: string,
  body: string,
  referenceType?: string | null,
  referenceId?: string | null,
): Promise<{ successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;

  const data: Record<string, string> = {};
  if (referenceType) data.referenceType = referenceType;
  if (referenceId) data.referenceId = referenceId;
  data.type = 'admin_notification';

  for (const profileId of recipientIds) {
    try {
      const result = await sendPushNotification(supabase, {
        profileId,
        title,
        body,
        data: Object.keys(data).length > 0 ? data : undefined,
      });

      successful += result.successful;
      failed += result.failed;

      structuredLog('PUSH_TO_RECIPIENT', {
        profileId,
        totalDevices: result.totalDevices,
        successful: result.successful,
        failed: result.failed,
      });
    } catch (err) {
      failed++;
      structuredLog('PUSH_TO_RECIPIENT_FAILED', {
        profileId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return { successful, failed };
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

    const permissionError = validatePermissions(callerRole, body.audience.type);

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
    // Step 5–6: Create Notification + Recipients
    // ══════════════════════════════════════════════════════════════════
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
    });

    if ('error' in notifResult) {
      return errorResponse(notifResult.error, 500);
    }

    const { notificationId } = notifResult;

    // ══════════════════════════════════════════════════════════════════
    // Step 7: Send Push Notifications
    // ══════════════════════════════════════════════════════════════════
    let successfulPushes = 0;
    let failedPushes = 0;

    if (body.sendPush && recipientIds.length > 0) {
      const pushResult = await dispatchPushToRecipients(
        adminClient,
        recipientIds,
        body.title,
        body.body,
        body.referenceType,
        body.referenceId,
      );

      successfulPushes = pushResult.successful;
      failedPushes = pushResult.failed;

      structuredLog('PUSH_DISPATCH_COMPLETE', {
        notificationId,
        successful: successfulPushes,
        failed: failedPushes,
      });
    }

    // ══════════════════════════════════════════════════════════════════
    // Step 8: Return Summary
    // ══════════════════════════════════════════════════════════════════
    structuredLog('DISPATCH_COMPLETE', {
      notificationId,
      totalRecipients: notifResult.inserted,
      successfulPushes,
      failedPushes,
    });

    return jsonResponse({
      success: true,
      notificationId,
      totalRecipients: notifResult.inserted,
      successfulPushes,
      failedPushes,
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
