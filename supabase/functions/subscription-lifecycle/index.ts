// ============================================================================
// Edge Function: subscription-lifecycle (Scheduled / Cron)
//
// Daily backend job that advances student_subscriptions through the approved
// Phase 11B subscription lifecycle state machine AND dispatches the
// subscription lifecycle notifications (Phase 11B.2).
//
// ── Phase 11B.1 — State transitions (implemented in 11B.1) ────────────────
//   Transition 1 — ACTIVE → GRACE
//     When:   status = 'active'
//             end_date < current_date
//             grace_end_date IS NOT NULL
//     Then:   status → 'grace'
//             INSERT (or safely reuse) an unresolved subscription_grace_periods
//             row — atomically, via the SECURITY DEFINER RPC
//             public.transition_subscription_to_grace (migration 103, H2 fix).
//             The status claim + grace-row write commit together, so a
//             grace-row failure can never leave the subscription in 'grace'
//             without a grace record.
//             subscription_history row written automatically by the
//             trg_student_subscriptions_auto_history trigger (same transaction)
//
//   Transition 2 — GRACE → EXPIRED
//     When:   status = 'grace'
//             grace_end_date < current_date
//     Then:   status → 'expired'
//             Resolve the open subscription_grace_periods row:
//               resolution   = 'expired_no_payment'
//               resolved_at  = now()
//             subscription_history row written automatically by the trigger
//
// ── Phase 11B.2 — Lifecycle notifications (added in this phase) ────────────
// Reuses the EXISTING notification infrastructure (notifications +
// notification_recipients tables + _shared/pushNotification.ts) — the same
// reference-based idempotency pattern used by complete-course-purchase.
//
//   N1 Expiry reminders        — 7 / 3 / 1 days before end_date (active)
//   N2 Grace period started    — any subscription now in 'grace'
//   N3 Grace period ending     — 1 day before grace_end_date
//   N4 Subscription expired    — grace resolved as 'expired_no_payment'
//   N5 Content window ending   — 1 day before content_access_end_date
//   N6 Content window expired  — content_access_end_date in the past
//
// The two existing event types are reused (subscription_expiring /
// subscription_expired); each notification kind is distinguished by its own
// reference_type + subscription reference_id, which also drives duplicate
// prevention (a student can never receive the same lifecycle notification
// twice — safe against cron retries and overlapping runs).
//
// Remaining lifecycle work — renewal improvements — is OUT OF SCOPE for this
// phase and will be implemented in later phases.
//
// ── Schedule (recommended, NOT configured in this repo) ────────────────────
// Supabase dashboard → Database → Cron (or pg_cron):
//   select cron.schedule(
//     'subscription-lifecycle-daily',
//     '0 0 * * *',    -- daily at 00:00 UTC
//     $url$https://<project-ref>.supabase.co/functions/v1/subscription-lifecycle$url$
//   );
//
// A twice-daily schedule (00:00 / 12:00 UTC) accelerates catch-up after an
// outage; the job is date-relative and idempotent, so extra runs are safe.
//
// Expected runtime: sub-second at typical volumes (a few narrow selects + a
// handful of point updates + notification inserts). Large backlogs drain
// across runs via the BATCH_LIMIT constant — never in a single unbounded
// invocation.
//
// Retry behaviour: overlapping cron deliveries and manual re-runs are SAFE.
// Every transition uses a conditional UPDATE (WHERE status = 'current') that
// atomically claims the row, so a second run finds nothing left to do.
// Every notification is guarded by the reference-based idempotency check, so
// a retried run cannot double-send.
//
// ⚠️ verify_jwt = false — this function is called by the internal cron
//    scheduler, not by an authenticated user. When wiring the cron trigger,
//    deploy this function with verify_jwt = false (same as
//    recording-timeout). No config.toml entry is added here because cron is
//    intentionally configured in the dashboard, matching repo precedent.
//
// @module edge-functions/subscription-lifecycle
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { sendPushNotification } from '../_shared/pushNotification.ts';

// ─── Constants ──────────────────────────────────────────────────────────────

// Safety cap on rows processed per invocation. The job is date-relative and
// idempotent, so any backlog simply drains on subsequent runs.
const BATCH_LIMIT = 500;

// Default middle expiry reminder (days before end_date). Seeded value in
// system_settings is 3 (expiry_notice_days); the anchor reminders are 7 and 1.
const DEFAULT_EXPIRY_NOTICE_DAYS = 3;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface LifecycleCandidate {
  subscription_id: string;
  student_id: string;
  institute_id: string;
  end_date: string;
  grace_end_date: string | null;
  is_auto_renew: boolean;
}

interface LifecycleResult {
  processed: number;
  active_to_grace: number;
  grace_to_expired: number;
  skipped: number;
  failed: number;
  notifications_sent: number;
  notifications_skipped: number;
  notifications_failed: number;
  execution_time: number;
}

interface LifecycleResponse {
  success: boolean;
  result?: LifecycleResult;
  error?: string;
}

type NotificationOutcome = 'sent' | 'skipped' | 'failed';

// Reused event types — must match the notification_event_type enum values
// that already exist (Domain 09 + commerce additions).
type LifecycleEventType = 'subscription_expiring' | 'subscription_expired';

// ─── Structured Logging ─────────────────────────────────────────────────────

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'subscription-lifecycle',
      event,
      ...data,
    }),
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: LifecycleResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 500): Response {
  structuredLog('LIFECYCLE_ERROR', { error, statusCode: status });
  return jsonResponse({ success: false, error }, status);
}

// UTC calendar date (YYYY-MM-DD) — consistent with the date semantics used by
// the purchase flow (complete-subscription-purchase) and the seeded system
// settings (grace_days = 7, content_access_days = 30).
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Whole calendar days between two YYYY-MM-DD dates (toIso - fromIso).
function diffDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000);
}

// PostgREST embedded one-to-many relationship returns an array; one-to-one
// returns a plain object. Normalise both shapes to the first row or null.
function firstEmbedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value) && value.length > 0) {
    return value[0] as Record<string, unknown>;
  }
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
}

// ─── Notification helpers (Phase 11B.2) ─────────────────────────────────────

/**
 * Create a single lifecycle notification for a student, reusing the EXACT
 * reference-based idempotency pattern from complete-course-purchase:
 *
 *   1. Idempotency check — notifications joined with notification_recipients
 *      filtered by (event_type, reference_type, reference_id, profile_id).
 *      If a row already exists, skip. This is safe against cron retries
 *      (sequential re-deliveries); a GENUINELY concurrent double-run could
 *      theoretically double-send in the SELECT→INSERT window (no unique
 *      constraint backs it), consistent with the accepted commerce pattern.
 *   2. INSERT notifications row (template_id NULL — fully rendered snapshot,
 *      same as commerce notifications; dispatched_at intentionally NULL to
 *      satisfy ck_notifications_dispatched_at).
 *   3. INSERT notification_recipients row (profile_id = the student's
 *      profiles.profile_id via student_details).
 *   4. Best-effort FCM push via the existing _shared/pushNotification helper
 *      (never throws; push failure is logged, never blocks the job).
 *
 * Returns 'sent' | 'skipped' | 'failed'.
 */
async function createSubscriptionNotification(
  supabase: ReturnType<typeof createClient>,
  params: {
    instituteId: string;
    profileId: string;
    eventType: LifecycleEventType;
    referenceType: string;
    referenceId: string;
    title: string;
    body: string;
  },
): Promise<NotificationOutcome> {
  const {
    instituteId,
    profileId,
    eventType,
    referenceType,
    referenceId,
    title,
    body,
  } = params;

  // ── Idempotency check ─────────────────────────────────────────────
  // Start from notifications with an inner join to notification_recipients
  // so PostgREST applies ALL filters (the pattern fixed in
  // complete-course-purchase — starting from notification_recipients drops
  // embedded filters and produces false-positive dedup matches).
  const { data: existing } = await supabase
    .from('notifications')
    .select('notification_id, notification_recipients!inner(recipient_id, profile_id)')
    .eq('event_type', eventType)
    .eq('reference_type', referenceType)
    .eq('reference_id', referenceId)
    .eq('notification_recipients.profile_id', profileId)
    .maybeSingle();

  if (existing) {
    structuredLog('NOTIFICATION_SKIPPED_DUPLICATE', {
      eventType,
      referenceType,
      referenceId,
      profileId,
    });
    return 'skipped';
  }

  // ── Insert notification row ───────────────────────────────────────
  const { data: notification, error: notifError } = await supabase
    .from('notifications')
    .insert({
      institute_id: instituteId,
      template_id: null,
      title: title.trim(),
      body: body.trim(),
      channel: 'in_app',
      event_type: eventType,
      triggered_by: null,
      reference_type: referenceType,
      reference_id: referenceId,
      total_recipients: 1,
    })
    .select('notification_id')
    .single();

  if (notifError || !notification) {
    structuredLog('NOTIFICATION_FAILED', {
      eventType,
      referenceType,
      referenceId,
      error: notifError?.message ?? 'Notification insert returned no id',
    });
    return 'failed';
  }

  // ── Insert recipient row ──────────────────────────────────────────
  const { error: recipientError } = await supabase
    .from('notification_recipients')
    .insert({
      notification_id: notification.notification_id,
      profile_id: profileId,
      institute_id: instituteId,
      is_read: false,
      received_at: new Date().toISOString(),
    });

  if (recipientError) {
    // Notification row exists but recipient insert failed — log and continue
    // (matches commerce behaviour; never throws).
    structuredLog('NOTIFICATION_RECIPIENT_FAILED', {
      eventType,
      referenceType,
      referenceId,
      error: recipientError.message,
    });
    return 'failed';
  }

  // ── Best-effort push (never throws) ───────────────────────────────
  try {
    const pushResult = await sendPushNotification(supabase, {
      profileId,
      title,
      body,
      data: { type: eventType, referenceType, referenceId },
    });
    structuredLog('NOTIFICATION_PUSH', {
      eventType,
      referenceType,
      referenceId,
      totalDevices: pushResult.totalDevices,
      successful: pushResult.successful,
      failed: pushResult.failed,
    });
  } catch (err) {
    structuredLog('NOTIFICATION_PUSH_FAILED', {
      eventType,
      referenceType,
      referenceId,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }

  structuredLog('NOTIFICATION_SENT', {
    eventType,
    referenceType,
    referenceId,
    profileId,
  });
  return 'sent';
}

function tallyNotification(
  result: LifecycleResult,
  outcome: NotificationOutcome,
): void {
  if (outcome === 'sent') result.notifications_sent++;
  else if (outcome === 'skipped') result.notifications_skipped++;
  else result.notifications_failed++;
}

/**
 * Load the configured middle expiry reminder per institute from
 * system_settings (expiry_notice_days, seeded = 3), falling back to
 * DEFAULT_EXPIRY_NOTICE_DAYS. Returns a Map<institute_id, days>.
 */
async function loadExpiryReminderDays(
  supabase: ReturnType<typeof createClient>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await supabase
    .from('system_settings')
    .select('institute_id, setting_value')
    .eq('setting_key', 'expiry_notice_days')
    .eq('is_active', true);

  for (const row of data ?? []) {
    const days = parseInt(String((row as Record<string, unknown>).setting_value), 10);
    if (!Number.isNaN(days) && days > 0) {
      map.set(String((row as Record<string, unknown>).institute_id), days);
    }
  }
  return map;
}

// Reminder schedule for an institute: anchors 7 and 1, middle from settings.
function reminderDaysFor(
  reminderDaysMap: Map<string, number>,
  instituteId: string,
): number[] {
  const middle = reminderDaysMap.get(instituteId) ?? DEFAULT_EXPIRY_NOTICE_DAYS;
  return [...new Set([7, middle, 1])].sort((a, b) => b - a);
}

/**
 * Mark a grace period as having had its reminder notification sent.
 * Uses the schema's dedicated columns (subscription_grace_periods.
 * reminders_sent / last_reminder_sent_at), which are indexed by
 * idx_subscription_grace_periods_reminders for unresolved grace periods.
 */
async function markGraceReminderSent(
  supabase: ReturnType<typeof createClient>,
  graceId: string,
  currentCount: number,
): Promise<void> {
  const { error } = await supabase
    .from('subscription_grace_periods')
    .update({
      reminders_sent: currentCount + 1,
      last_reminder_sent_at: new Date().toISOString(),
    })
    .eq('grace_id', graceId);

  if (error) {
    structuredLog('GRACE_REMINDER_MARK_FAILED', {
      graceId,
      error: error.message,
    });
  }
}

/**
 * Dispatch ALL eligible Phase 11B.2 lifecycle notifications. Runs after the
 * state transitions so grace/content states are current. Every notification
 * is individually guarded by the reference-based idempotency check — a
 * retried or overlapping run simply skips what was already sent.
 */
async function dispatchSubscriptionNotifications(
  supabase: ReturnType<typeof createClient>,
  today: string,
  result: LifecycleResult,
): Promise<void> {
  const reminderDaysMap = await loadExpiryReminderDays(supabase);

  // ── N1: Expiry reminders (7 / 3 / 1 days before end_date) ─────────
  const { data: expiring, error: expiringError } = await supabase
    .from('student_subscriptions')
    .select(
      'subscription_id, student_id, institute_id, end_date, student_details!inner(profile_id)',
    )
    .eq('status', 'active')
    .gt('end_date', today)
    .lte('end_date', addDays(today, 7))
    .limit(BATCH_LIMIT);

  if (expiringError) {
    structuredLog('NOTIFICATION_QUERY_FAILED', {
      section: 'expiry_reminders',
      error: expiringError.message,
    });
  } else {
    for (const row of expiring ?? []) {
      const daysLeft = diffDays(today, String(row.end_date));
      if (!reminderDaysFor(reminderDaysMap, String(row.institute_id)).includes(daysLeft)) {
        continue;
      }
      const details = firstEmbedded((row as Record<string, unknown>).student_details);
      const profileId = details?.profile_id;
      if (!profileId) continue;

      const outcome = await createSubscriptionNotification(supabase, {
        instituteId: String(row.institute_id),
        profileId: String(profileId),
        eventType: 'subscription_expiring',
        referenceType: `subscription_expiry_reminder_${daysLeft}d`,
        referenceId: String(row.subscription_id),
        title: 'Subscription Expiring Soon',
        body: `Your subscription expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Renew now to continue uninterrupted access.`,
      });
      tallyNotification(result, outcome);
    }
  }

  // ── N2: Grace period started (any subscription in 'grace') ─────────
  const { data: inGrace, error: graceStartError } = await supabase
    .from('student_subscriptions')
    .select(
      'subscription_id, student_id, institute_id, student_details!inner(profile_id), subscription_grace_periods!inner(grace_id, reminders_sent)',
    )
    .eq('status', 'grace')
    .limit(BATCH_LIMIT);

  if (graceStartError) {
    structuredLog('NOTIFICATION_QUERY_FAILED', {
      section: 'grace_started',
      error: graceStartError.message,
    });
  } else {
    for (const row of inGrace ?? []) {
      const details = firstEmbedded((row as Record<string, unknown>).student_details);
      const profileId = details?.profile_id;
      if (!profileId) continue;

      const outcome = await createSubscriptionNotification(supabase, {
        instituteId: String(row.institute_id),
        profileId: String(profileId),
        eventType: 'subscription_expired',
        referenceType: 'subscription_grace_started',
        referenceId: String(row.subscription_id),
        title: 'Subscription Expired — Grace Period',
        body: 'Your subscription has expired. You have 7 days remaining to renew while Live Classes are still available.',
      });
      tallyNotification(result, outcome);

      if (outcome === 'sent') {
        const grace = firstEmbedded((row as Record<string, unknown>).subscription_grace_periods);
        if (grace?.grace_id) {
          await markGraceReminderSent(
            supabase,
            String(grace.grace_id),
            Number(grace.reminders_sent ?? 0),
          );
        }
      }
    }
  }

  // ── N3: Grace period ending (grace_end_date = tomorrow) ────────────
  const { data: graceEnding, error: graceEndingError } = await supabase
    .from('student_subscriptions')
    .select(
      'subscription_id, student_id, institute_id, grace_end_date, student_details!inner(profile_id), subscription_grace_periods!inner(grace_id, reminders_sent)',
    )
    .eq('status', 'grace')
    .eq('grace_end_date', addDays(today, 1))
    .limit(BATCH_LIMIT);

  if (graceEndingError) {
    structuredLog('NOTIFICATION_QUERY_FAILED', {
      section: 'grace_ending',
      error: graceEndingError.message,
    });
  } else {
    for (const row of graceEnding ?? []) {
      const details = firstEmbedded((row as Record<string, unknown>).student_details);
      const profileId = details?.profile_id;
      if (!profileId) continue;

      const outcome = await createSubscriptionNotification(supabase, {
        instituteId: String(row.institute_id),
        profileId: String(profileId),
        eventType: 'subscription_expiring',
        referenceType: 'subscription_grace_ending',
        referenceId: String(row.subscription_id),
        title: 'Grace Period Ending Tomorrow',
        body: 'Your grace period ends tomorrow.',
      });
      tallyNotification(result, outcome);

      if (outcome === 'sent') {
        const grace = firstEmbedded((row as Record<string, unknown>).subscription_grace_periods);
        if (grace?.grace_id) {
          await markGraceReminderSent(
            supabase,
            String(grace.grace_id),
            Number(grace.reminders_sent ?? 0),
          );
        }
      }
    }
  }

  // ── N4: Subscription expired (grace resolved, no payment) ──────────
  const { data: expired, error: expiredError } = await supabase
    .from('student_subscriptions')
    .select(
      'subscription_id, student_id, institute_id, student_details!inner(profile_id), subscription_grace_periods!inner(grace_id, resolution)',
    )
    .eq('status', 'expired')
    .eq('subscription_grace_periods.resolution', 'expired_no_payment')
    .limit(BATCH_LIMIT);

  if (expiredError) {
    structuredLog('NOTIFICATION_QUERY_FAILED', {
      section: 'subscription_expired',
      error: expiredError.message,
    });
  } else {
    for (const row of expired ?? []) {
      const details = firstEmbedded((row as Record<string, unknown>).student_details);
      const profileId = details?.profile_id;
      if (!profileId) continue;

      const outcome = await createSubscriptionNotification(supabase, {
        instituteId: String(row.institute_id),
        profileId: String(profileId),
        eventType: 'subscription_expired',
        referenceType: 'subscription_expired',
        referenceId: String(row.subscription_id),
        title: 'Subscription Expired',
        body: 'Your subscription has expired. Live Classes are disabled. Recorded Classes, Notes and PDFs remain available until your content access period ends.',
      });
      tallyNotification(result, outcome);
    }
  }

  // ── N5: Content window ending (content_access_end_date = tomorrow) ─
  // NOTE: these content-window notifications target ALL status='expired'
  // rows by date. Once the Phase 11B renewal flow creates a NEW active row
  // (per the approved architecture), a future phase should exclude expired
  // rows where the student already holds a newer active/grace subscription
  // to avoid post-renewal stale notifications.
  const { data: contentEnding, error: contentEndingError } = await supabase
    .from('student_subscriptions')
    .select(
      'subscription_id, student_id, institute_id, content_access_end_date, student_details!inner(profile_id)',
    )
    .eq('status', 'expired')
    .eq('content_access_end_date', addDays(today, 1))
    .limit(BATCH_LIMIT);

  if (contentEndingError) {
    structuredLog('NOTIFICATION_QUERY_FAILED', {
      section: 'content_ending',
      error: contentEndingError.message,
    });
  } else {
    for (const row of contentEnding ?? []) {
      const details = firstEmbedded((row as Record<string, unknown>).student_details);
      const profileId = details?.profile_id;
      if (!profileId) continue;

      const outcome = await createSubscriptionNotification(supabase, {
        instituteId: String(row.institute_id),
        profileId: String(profileId),
        eventType: 'subscription_expiring',
        referenceType: 'subscription_content_ending',
        referenceId: String(row.subscription_id),
        title: 'Content Access Ending Tomorrow',
        body: 'Tomorrow is the final day to access your recorded classes, notes and PDFs.',
      });
      tallyNotification(result, outcome);
    }
  }

  // ── N6: Content window expired (content_access_end_date in past) ───
  const { data: contentExpired, error: contentExpiredError } = await supabase
    .from('student_subscriptions')
    .select(
      'subscription_id, student_id, institute_id, content_access_end_date, student_details!inner(profile_id)',
    )
    .eq('status', 'expired')
    .not('content_access_end_date', 'is', null)
    .lt('content_access_end_date', today)
    .limit(BATCH_LIMIT);

  if (contentExpiredError) {
    structuredLog('NOTIFICATION_QUERY_FAILED', {
      section: 'content_expired',
      error: contentExpiredError.message,
    });
  } else {
    for (const row of contentExpired ?? []) {
      const details = firstEmbedded((row as Record<string, unknown>).student_details);
      const profileId = details?.profile_id;
      if (!profileId) continue;

      const outcome = await createSubscriptionNotification(supabase, {
        instituteId: String(row.institute_id),
        profileId: String(profileId),
        eventType: 'subscription_expired',
        referenceType: 'subscription_content_expired',
        referenceId: String(row.subscription_id),
        title: 'Subscription Fully Expired',
        body: 'Your subscription has completely expired. Renew your subscription to continue learning.',
      });
      tallyNotification(result, outcome);
    }
  }
}

// ─── Main Handler ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Allow POST (cron trigger) and GET (health check / manual run)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return errorResponse('Method not allowed. Use POST or GET.', 405);
  }

  const startedAt = Date.now();
  structuredLog('LIFECYCLE_JOB_STARTED', { batchLimit: BATCH_LIMIT });

  try {
    // ── Initialize Supabase client (service role — cron internal) ────
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse(
        'Server configuration error: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const today = todayUtc();

    const result: LifecycleResult = {
      processed: 0,
      active_to_grace: 0,
      grace_to_expired: 0,
      skipped: 0,
      failed: 0,
      notifications_sent: 0,
      notifications_skipped: 0,
      notifications_failed: 0,
      execution_time: 0,
    };

    // ── TRANSITION 1: ACTIVE → GRACE ─────────────────────────────────
    const { data: activeCandidates, error: activeQueryError } = await supabase
      .from('student_subscriptions')
      .select(
        'subscription_id, student_id, institute_id, end_date, grace_end_date, is_auto_renew',
      )
      .eq('status', 'active')
      .lt('end_date', today)
      .not('grace_end_date', 'is', null)
      .limit(BATCH_LIMIT);

    if (activeQueryError) {
      return errorResponse(`Database query failed: ${activeQueryError.message}`);
    }

    const activeRows = (activeCandidates ?? []) as LifecycleCandidate[];
    result.processed += activeRows.length;

    for (const row of activeRows) {
      try {
        // H2 fix (migration 103): atomically transition ACTIVE → GRACE via the
        // SECURITY DEFINER RPC. The status claim + grace-row insert (or reuse
        // of a stale unresolved row) now happen in ONE database transaction,
        // so a grace-row failure can no longer leave the subscription in
        // 'grace' without a grace record.
        //
        // The RPC applies the exact same eligibility predicates as the old
        // claim UPDATE (status='active', end_date < today, grace_end_date NOT
        // NULL) and preserves the grace_start_date clamp + trigger_reason
        // semantics. Returns:
        //   true  → this run transitioned the row (grace row created/reused)
        //   false → row no longer eligible (already grace/expired, or claimed
        //           by a concurrent run) — treat as skipped, not failed.
        const { data: transitioned, error: rpcError } = await supabase.rpc(
          'transition_subscription_to_grace',
          { p_subscription_id: row.subscription_id },
        );

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        // Row already transitioned by another run (or no longer eligible).
        if (transitioned === false) {
          result.skipped++;
          structuredLog('TRANSITION_SKIPPED', {
            subscriptionId: row.subscription_id,
            targetStatus: 'grace',
          });
          continue;
        }

        result.active_to_grace++;
        structuredLog('TRANSITION_ACTIVE_TO_GRACE', {
          subscriptionId: row.subscription_id,
          endDate: row.end_date,
          graceEndDate: row.grace_end_date,
        });
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        structuredLog('TRANSITION_ACTIVE_TO_GRACE_FAILED', {
          subscriptionId: row.subscription_id,
          error: message,
        });
      }
    }

    // ── TRANSITION 2: GRACE → EXPIRED ────────────────────────────────
    const { data: graceCandidates, error: graceQueryError } = await supabase
      .from('student_subscriptions')
      .select('subscription_id, grace_end_date')
      .eq('status', 'grace')
      .lt('grace_end_date', today)
      .limit(BATCH_LIMIT);

    if (graceQueryError) {
      return errorResponse(`Database query failed: ${graceQueryError.message}`);
    }

    const graceRows = (graceCandidates ?? []) as Array<{
      subscription_id: string;
      grace_end_date: string | null;
    }>;
    result.processed += graceRows.length;

    for (const row of graceRows) {
      try {
        // Atomic claim: only expire if the row is STILL 'grace' with the
        // window still elapsed.
        const { data: claimed, error: claimError } = await supabase
          .from('student_subscriptions')
          .update({ status: 'expired' })
          .eq('subscription_id', row.subscription_id)
          .eq('status', 'grace')
          .lt('grace_end_date', today)
          .select('subscription_id');

        if (claimError) {
          throw new Error(claimError.message);
        }

        if (!claimed || claimed.length === 0) {
          result.skipped++;
          structuredLog('TRANSITION_SKIPPED', {
            subscriptionId: row.subscription_id,
            targetStatus: 'expired',
          });
          continue;
        }

        // Resolve the open grace window (idempotent: only unresolved rows).
        // .select() lets us detect a 0-row resolution for the H2 diagnostic
        // below — a claimed GRACE→EXPIRED transition must always have an
        // unresolved grace row to resolve.
        const { data: resolvedRows, error: resolveError } = await supabase
          .from('subscription_grace_periods')
          .update({
            resolution: 'expired_no_payment',
            resolved_at: new Date().toISOString(),
          })
          .eq('subscription_id', row.subscription_id)
          .is('resolution', null)
          .select('grace_id');

        if (resolveError) {
          throw new Error(resolveError.message);
        }

        // H2 diagnostic: a successfully claimed GRACE→EXPIRED transition with
        // no resolvable grace row means this subscription has no grace-period
        // record (e.g. corrupted data from the pre-fix partial-failure window,
        // or a manually deleted row). Flag it for ops — do NOT fabricate a row
        // here; the ops-only reconciliation script repairs these.
        if (!resolvedRows || resolvedRows.length === 0) {
          structuredLog('GRACE_ROW_MISSING', {
            subscriptionId: row.subscription_id,
            graceEndDate: row.grace_end_date,
          });
        }

        result.grace_to_expired++;
        structuredLog('TRANSITION_GRACE_TO_EXPIRED', {
          subscriptionId: row.subscription_id,
          graceEndDate: row.grace_end_date,
        });
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        structuredLog('TRANSITION_GRACE_TO_EXPIRED_FAILED', {
          subscriptionId: row.subscription_id,
          error: message,
        });
      }
    }

    // ── NOTIFICATIONS: dispatch all eligible lifecycle notifications ──
    await dispatchSubscriptionNotifications(supabase, today, result);

    // ── Summary ─────────────────────────────────────────────────────
    result.execution_time = Date.now() - startedAt;
    structuredLog('LIFECYCLE_JOB_COMPLETE', { ...result });

    return jsonResponse({ success: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('UNEXPECTED_ERROR', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('An unexpected error occurred.', 500);
  }
});
