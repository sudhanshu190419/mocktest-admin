// ============================================================================
// Shared Helper: Subscription Access Control Service (Phase 11C)
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Centralized backend authorization for every subscription-gated module:
// Live Classes · Recorded Classes · Notes · PDFs · Downloads · Course
// Lessons · PYQ content · Mock Tests · Practice Tests.
//
// ── Access tiers (single source of truth) ──────────────────────────────────
//   active        — everything available
//   grace         — everything available (incl. live classes)
//   content_only  — live classes blocked; content available until
//                   content_access_end_date (recordings, notes, PDFs,
//                   downloads, course lessons, PYQ, mock & practice tests)
//   none          — everything blocked until renewal
//
// Tier derivation (status-first, dates as refinement):
//   status = 'active'  → active   (if end_date already passed and a grace
//                                  window exists, tier = grace — tolerates
//                                  lifecycle-job lag)
//   status = 'grace'   → grace    (if grace_end_date passed → content_only /
//                                  none)
//   status = 'expired' → content_only while content_access_end_date >= today,
//                        otherwise none
//   else (pending/cancelled/refunded) → none
//
// ── Role handling ──────────────────────────────────────────────────────────
// The caller's REAL role is resolved from profiles (never trusted from a
// client-declared value). admin / teacher bypass subscription checks
// entirely (full access). Only 'student' is gated.
//
// ── Performance ────────────────────────────────────────────────────────────
// createSubscriptionAccessChecker() memoizes the single DB state load for
// the lifetime of the request, so multiple can*() calls share ONE query —
// no repeated subscription lookups.
//
// ── Design decisions ───────────────────────────────────────────────────────
// • system_settings is NOT read here. grace_end_date / content_access_end_date
//   are stored per-subscription and were computed FROM system_settings at
//   purchase/backfill time (Phase 11A/11B). Stored dates are the authoritative
//   source of truth; re-deriving them at check time would be redundant and
//   could drift from what the lifecycle job actually wrote.
//
// @module _shared/subscriptionAccess
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════════════════════════
// Diagnostic logging (ASSIGNED-NOTES TRACE — TEMPORARY)
// ═══════════════════════════════════════════════════════════════════════════

/** Structured one-line JSON log for the assigned-notes access trace. */
function diagLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'subscriptionAccess',
      event,
      ...data,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Types — Public
// ═══════════════════════════════════════════════════════════════════════════

export type AccessTier = 'active' | 'grace' | 'content_only' | 'none';

export type AccessReason =
  | 'active'
  | 'grace'
  | 'content_window'
  | 'expired'
  | 'no_subscription'
  | 'role_bypass';

/** Raw subscription + resolved context loaded once per request. */
export interface SubscriptionAccessState {
  /** Authoritative role from profiles — never client-supplied. */
  role: string;
  /**
   * True when the student permanently owns the scoped course
   * (course_enrollments.enrollment_type = 'purchase', migration 096).
   * When true the summary behaves like an 'active' tier with all
   * permissions enabled — no subscription row required.
   */
  permanentOwner: boolean;
  hasSubscription: boolean;
  subscriptionId: string | null;
  status: string | null;
  planName: string | null;
  instituteId: string | null;
  /** Course this state is scoped to (null = global / not course-filtered). */
  courseId: string | null;
  endDate: string | null;
  graceEndDate: string | null;
  contentAccessEndDate: string | null;
  isTrial: boolean;
}

/** Decision returned by every can*() method. */
export interface AccessDecision {
  allowed: boolean;
  tier: AccessTier;
  reason: AccessReason;
  /** User-facing message for denied access (undefined when allowed). */
  message?: string;
}

/** Full status payload returned by getSubscriptionAccessSummary(). */
export interface SubscriptionAccessSummary {
  tier: AccessTier;
  /** Friendly status: active | grace | content_only | none */
  status: AccessTier;
  /** Course this summary is scoped to (null when global/uncourse-filtered). */
  courseId: string | null;
  plan: string | null;
  hasSubscription: boolean;
  subscriptionId: string | null;
  endDate: string | null;
  graceEndDate: string | null;
  contentAccessEndDate: string | null;
  daysRemaining: number | null;
  isTrial: boolean;
  canJoinLive: boolean;
  canViewRecorded: boolean;
  canDownloadNotes: boolean;
  canOpenPdf: boolean;
  canAccessCourseLesson: boolean;
  canAccessPyq: boolean;
  canAttemptMockTests: boolean;
  canAttemptPracticeTest: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants — standardized user-facing messages
// ═══════════════════════════════════════════════════════════════════════════

export const MESSAGES = {
  LIVE_BLOCKED: 'Your subscription has expired. Renew to continue attending live classes.',
  CONTENT_BLOCKED: 'Your content access period has ended. Renew your subscription to continue.',
  NO_SUBSCRIPTION: 'You do not have an active subscription. Please subscribe to continue.',
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Role helpers — staff vs student gating
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Roles that bypass subscription gating entirely (staff only).
 *
 * NOTE: since migration 046 the user_role enum also contains 'user' — the
 * pre-purchase placeholder role assigned to every new registration. 'user'
 * is a STUDENT-like role (upgraded to 'student' by complete-course-purchase
 * on first purchase) and MUST follow the normal student evaluation path.
 * Only actual staff roles (admin / teacher) bypass.
 */
export const STAFF_ROLES: ReadonlySet<string> = new Set(['admin', 'teacher']);

/** True when `role` is a staff role that bypasses subscription gating. */
export function isStaffRole(role: string | null | undefined): boolean {
  return role != null && STAFF_ROLES.has(role);
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal date helpers (UTC — consistent with the purchase/lifecycle flow)
// ═══════════════════════════════════════════════════════════════════════════

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function diffDays(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure tier logic
// ═══════════════════════════════════════════════════════════════════════════

/** Content is available in every tier except 'none'. */
function contentTier(state: SubscriptionAccessState, today: string): AccessTier {
  if (state.contentAccessEndDate && state.contentAccessEndDate >= today) {
    return 'content_only';
  }
  return 'none';
}

/**
 * Compute the access tier from a loaded state. Pure and deterministic —
 * no dates are hardcoded; everything derives from the row + today.
 */
export function evaluateTier(
  state: SubscriptionAccessState,
  today: string = todayUtc(),
): AccessTier {
  // [DIAGNOSTIC — assigned-notes trace] log the exact inputs the tier is
  // derived from.
  diagLog('EVALUATE_TIER_INPUT', {
    role: state.role,
    permanentOwner: state.permanentOwner,
    hasSubscription: state.hasSubscription,
    status: state.status ?? null,
    courseId: state.courseId ?? null,
    endDate: state.endDate ?? null,
    graceEndDate: state.graceEndDate ?? null,
    contentAccessEndDate: state.contentAccessEndDate ?? null,
    today,
  });

  // Permanent course owners (full-course purchasers / converted owners)
  // are never subscription-gated: the DB RLS layer grants them access via
  // is_permanent_course_owner (migration 096). The summary mirrors that.
  if (state.permanentOwner) {
    return 'active';
  }

  // Staff (admin / teacher) are never subscription-gated. The 'user' role
  // (pre-purchase placeholder since migration 046) follows the normal
  // student evaluation path below.
  if (isStaffRole(state.role)) {
    return 'active';
  }

  if (!state.hasSubscription || !state.status) {
    return 'none';
  }

  switch (state.status) {
    case 'active':
      // end_date already passed (lifecycle job lag) → behave as grace if a
      // grace window exists, otherwise fall through to content evaluation.
      if (state.endDate && state.endDate < today) {
        if (state.graceEndDate && state.graceEndDate >= today) return 'grace';
        return contentTier(state, today);
      }
      return 'active';

    case 'grace':
      if (state.graceEndDate && state.graceEndDate >= today) return 'grace';
      return contentTier(state, today);

    case 'expired':
      return contentTier(state, today);

    default: // pending, cancelled, refunded
      return 'none';
  }
}

/** Decide live-class access: active or grace only. */
export function canJoinLiveClass(
  state: SubscriptionAccessState,
  today: string = todayUtc(),
): AccessDecision {
  const tier = evaluateTier(state, today);
  const allowed = tier === 'active' || tier === 'grace';
  if (allowed) return { allowed: true, tier, reason: tier === 'grace' ? 'grace' : 'active' };
  if (!state.hasSubscription) {
    return {
      allowed: false,
      tier,
      reason: 'no_subscription',
      message: MESSAGES.NO_SUBSCRIPTION,
    };
  }
  return { allowed: false, tier, reason: 'expired', message: MESSAGES.LIVE_BLOCKED };
}

/** Decide content access: any tier except 'none'. */
export function canAccessContent(
  state: SubscriptionAccessState,
  today: string = todayUtc(),
): AccessDecision {
  const tier = evaluateTier(state, today);
  const allowed = tier !== 'none';
  if (allowed) {
    return {
      allowed: true,
      tier,
      reason: tier === 'active' ? 'active' : tier === 'grace' ? 'grace' : 'content_window',
    };
  }
  if (!state.hasSubscription) {
    return {
      allowed: false,
      tier,
      reason: 'no_subscription',
      message: MESSAGES.NO_SUBSCRIPTION,
    };
  }
  return { allowed: false, tier, reason: 'expired', message: MESSAGES.CONTENT_BLOCKED };
}

// ═══════════════════════════════════════════════════════════════════════════
// Permanent ownership evaluation (migration 096 helper)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate permanent course ownership using the existing DB helper
 * `is_permanent_course_owner` (migration 096) — no entitlement logic is
 * duplicated here.
 *
 * The helper is SECURITY DEFINER and scoped via auth.uid(), so it must be
 * invoked through a client that carries the CALLER's JWT (the anon client),
 * never the service-role client.
 *
 * - Course-scoped summary: one exact-helper RPC for that course.
 * - Global summary: the caller's own enrollments are enumerated via RLS,
 *   then the exact helper runs per course (ANY-course semantics).
 *
 * Fail-closed: any RPC/network error yields false (normal subscription path).
 */
async function evaluatePermanentOwnership(
  userClient: ReturnType<typeof createClient>,
  courseId: string | null | undefined,
): Promise<boolean> {
  try {
    if (courseId) {
      const { data, error } = await userClient.rpc('is_permanent_course_owner', {
        p_course_id: courseId,
      });
      if (error) {
        diagLog('OWNERSHIP_ERROR', { courseScope: courseId, message: error.message });
        return false;
      }
      return data === true;
    }

    // Global summary — enumerate the caller's own purchase enrollments
    // (RLS-scoped to get_my_student_id) and run the exact helper per course.
    // Pre-filtering on enrollment_type avoids helper RPCs for rows that can
    // never qualify (the helper itself re-checks the full predicate).
    const { data: enrollments, error: listError } = await userClient
      .from('course_enrollments')
      .select('course_id')
      .eq('enrollment_type', 'purchase');
    if (listError) {
      diagLog('OWNERSHIP_ERROR', { courseScope: 'global', message: listError.message });
      return false;
    }
    for (const row of (enrollments ?? []) as Array<{ course_id: string }>) {
      const { data, error } = await userClient.rpc('is_permanent_course_owner', {
        p_course_id: row.course_id,
      });
      if (error) {
        diagLog('OWNERSHIP_ERROR', { courseScope: 'global', courseId: row.course_id, message: error.message });
        continue;
      }
      if (data === true) return true;
    }
    return false;
  } catch (err) {
    diagLog('OWNERSHIP_ERROR', {
      courseScope: courseId ?? 'global',
      message: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// State loader (one DB round-trip, memoized per request)
// ═══════════════════════════════════════════════════════════════════════════

interface SubscriptionRow {
  subscription_id: string;
  student_id: string;
  institute_id: string;
  plan_id: string;
  course_id: string | null;
  status: string;
  end_date: string;
  grace_end_date: string | null;
  content_access_end_date: string | null;
  is_trial: boolean;
  created_at: string;
}

/**
 * Load the caller's authoritative role and their best (current) subscription.
 *
 * Uses a service-role client with an explicit profile_id filter — the same
 * pattern as the commerce functions. Never trusts client-supplied role or
 * subscription data.
 *
 * Row selection: the active/grace row wins (at most one per plan thanks to
 * migration 086); otherwise the most recent row by created_at is used
 * (e.g. an expired row that still carries a content window). A student may
 * hold multiple plans; the row that grants the highest tier governs access.
 */
async function loadSubscriptionAccessState(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  courseId?: string | null,
  userClient?: ReturnType<typeof createClient> | null,
): Promise<SubscriptionAccessState> {
  const empty: SubscriptionAccessState = {
    role: 'student',
    permanentOwner: false,
    hasSubscription: false,
    subscriptionId: null,
    status: null,
    planName: null,
    instituteId: null,
    courseId: null,
    endDate: null,
    graceEndDate: null,
    contentAccessEndDate: null,
    isTrial: false,
  };

  // ── 1. Authoritative role ──────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('profile_id', profileId)
    .maybeSingle();

  const role = (profile?.role as string | undefined) ?? 'student';
  diagLog('STATE_ROLE', { profileId, role });
  if (isStaffRole(role)) {
    // admin / teacher → bypass (tier = active, everything allowed).
    // hasSubscription is TRUE so summary consumers don't see a confusing
    // "no subscription" state alongside full access. The 'user' role is a
    // student-like placeholder (migration 046) — NOT a bypass; it falls
    // through to the normal subscription evaluation below.
    return { ...empty, role, hasSubscription: true };
  }

  // ── 2. Resolve student_id + institute_id ───────────────────────────
  const { data: student } = await supabase
    .from('student_details')
    .select('student_id, institute_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!student) {
    diagLog('STATE_STUDENT', {
      profileId,
      studentId: null,
      note: 'no student_details row — cannot be a student',
    });
    return empty;
  }

  diagLog('STATE_STUDENT', {
    profileId,
    studentId: student.student_id,
    instituteId: student.institute_id,
  });

  // ── 2.5 Permanent course ownership (migration 096) ────────────────
  // The summary is subscription-derived by design, but permanent owners
  // (full-course purchasers / converted owners) hold NO active
  // subscription row (status 'cancelled' after conversion) while the DB
  // RLS layer grants them access via is_permanent_course_owner. Evaluate
  // that same helper here (via the caller-JWT client so auth.uid()
  // resolves) and short-circuit to a permanent-owner summary.
  let permanentOwner = false;
  if (userClient) {
    permanentOwner = await evaluatePermanentOwnership(userClient, courseId);
    diagLog('OWNERSHIP_EVAL', {
      profileId,
      courseScope: courseId ?? 'global',
      permanentOwner,
      branch: permanentOwner ? 'permanent' : 'subscription',
    });
    if (permanentOwner) {
      return {
        ...empty,
        role,
        permanentOwner: true,
        hasSubscription: true,
        courseId: courseId ?? null,
      };
    }
  }

  // ── 3. Load the student's subscriptions (newest first) ─────────────
  let subsQuery = supabase
      .from('student_subscriptions')
      .select(
        'subscription_id, student_id, institute_id, plan_id, course_id, status, end_date, grace_end_date, content_access_end_date, is_trial, created_at',
      )
      .eq('student_id', student.student_id);

    // Phase 11G/11H: course-scoped evaluation — when a course is supplied,
    // only subscriptions for THAT course may govern access. Buying Course A
    // must never unlock Course B (even in the same stream).
    if (courseId) {
      subsQuery = subsQuery.eq('course_id', courseId);
    }

    const { data: rows } = await subsQuery
      .order('created_at', { ascending: false })
      .limit(50);

  const subs = (rows ?? []) as SubscriptionRow[];
  if (subs.length === 0) {
    diagLog('STATE_SUBSCRIPTIONS', {
      profileId,
      courseScope: courseId ?? 'global',
      count: 0,
      rows: [],
    });
    return empty;
  }

  diagLog('STATE_SUBSCRIPTIONS', {
    profileId,
    courseScope: courseId ?? 'global',
    count: subs.length,
    rows: subs.map((r) => ({
      subscriptionId: r.subscription_id,
      status: r.status,
      courseId: r.course_id ?? null,
      endDate: r.end_date,
      graceEndDate: r.grace_end_date,
      contentAccessEndDate: r.content_access_end_date,
    })),
  });

  // Pick the row that grants the HIGHEST tier, so an older expired row with
  // a live content window is never masked by a newer cancelled/refunded/
  // pending row (e.g. a failed renewal attempt).
  const today = todayUtc();
  const current =
    subs.find((r) => r.status === 'active' || r.status === 'grace') ??
    subs.find((r) => r.status === 'expired' &&
      r.content_access_end_date !== null &&
      r.content_access_end_date >= today) ??
    subs[0];

  diagLog('STATE_CURRENT_ROW', {
    profileId,
    courseScope: courseId ?? 'global',
    selected: {
      subscriptionId: current.subscription_id,
      status: current.status,
      courseId: current.course_id ?? null,
      endDate: current.end_date,
      graceEndDate: current.grace_end_date,
      contentAccessEndDate: current.content_access_end_date,
    },
    permanentOwnerEvaluated: true,
    note: 'permanent ownership was evaluated and returned FALSE — the subscription row governs access',
  });

  // ── 4. Plan name (for the summary payload) ─────────────────────────
  let planName: string | null = null;
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('name')
    .eq('plan_id', current.plan_id)
    .maybeSingle();
  if (plan) planName = (plan as Record<string, unknown>).name as string;

  return {
    role,
    permanentOwner: false,
    hasSubscription: true,
    subscriptionId: current.subscription_id,
    status: current.status,
    planName,
    instituteId: current.institute_id,
    courseId: (current as SubscriptionRow).course_id ?? courseId ?? null,
    endDate: current.end_date,
    graceEndDate: current.grace_end_date,
    contentAccessEndDate: current.content_access_end_date,
    isTrial: current.is_trial,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — request-scoped checker (memoized state)
// ═══════════════════════════════════════════════════════════════════════════

export interface SubscriptionAccessChecker {
  canJoinLiveClass(today?: string): Promise<AccessDecision>;
  canViewRecordedClass(today?: string): Promise<AccessDecision>;
  canDownloadNotes(today?: string): Promise<AccessDecision>;
  canOpenPdf(today?: string): Promise<AccessDecision>;
  canAccessCourseLesson(today?: string): Promise<AccessDecision>;
  canAccessPyq(today?: string): Promise<AccessDecision>;
  canAccessMockTest(today?: string): Promise<AccessDecision>;
  canAttemptPracticeTest(today?: string): Promise<AccessDecision>;
  getSubscriptionAccessSummary(today?: string): Promise<SubscriptionAccessSummary>;
}

/**
 * Create a request-scoped access checker. The subscription state is loaded
 * ONCE (lazily) and memoized, so every can*() / summary call shares a single
 * DB load per request.
 */
export function createSubscriptionAccessChecker(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  courseId?: string | null,
  userClient?: ReturnType<typeof createClient> | null,
): SubscriptionAccessChecker {
  let statePromise: Promise<SubscriptionAccessState> | null = null;

  function state(): Promise<SubscriptionAccessState> {
    statePromise ??= loadSubscriptionAccessState(supabase, profileId, courseId, userClient);
    return statePromise;
  }

  return {
    async canJoinLiveClass(today) {
      return canJoinLiveClass(await state(), today);
    },
    async canViewRecordedClass(today) {
      return canAccessContent(await state(), today);
    },
    async canDownloadNotes(today) {
      return canAccessContent(await state(), today);
    },
    async canOpenPdf(today) {
      return canAccessContent(await state(), today);
    },
    async canAccessCourseLesson(today) {
      return canAccessContent(await state(), today);
    },
    async canAccessPyq(today) {
      return canAccessContent(await state(), today);
    },
    async canAccessMockTest(today) {
      return canAccessContent(await state(), today);
    },
    async canAttemptPracticeTest(today) {
      return canAccessContent(await state(), today);
    },
    async getSubscriptionAccessSummary(today) {
      const todayIso = today ?? todayUtc();
      const s = await state();
      const tier = evaluateTier(s, todayIso);
      const live = canJoinLiveClass(s, todayIso);
      const content = canAccessContent(s, todayIso);

      // [DIAGNOSTIC — assigned-notes trace] which branch produced the
      // final summary + every permission the mobile gates consume.
      diagLog('SUMMARY_FINAL', {
        permanentOwner: s.permanentOwner,
        branch: s.permanentOwner ? 'permanent' : 'subscription',
        courseId: s.courseId ?? null,
        tier,
        status: tier,
        hasSubscription: s.hasSubscription,
        canJoinLive: live.allowed,
        canViewRecorded: content.allowed,
        canDownloadNotes: content.allowed,
        canOpenPdf: content.allowed,
        canAccessCourseLesson: content.allowed,
        canAccessPyq: content.allowed,
        canAttemptMockTests: content.allowed,
        canAttemptPracticeTest: content.allowed,
      });

      let daysRemaining: number | null = null;
      if (tier === 'active' && s.endDate) daysRemaining = diffDays(todayIso, s.endDate);
      else if (tier === 'grace' && s.graceEndDate) {
        daysRemaining = diffDays(todayIso, s.graceEndDate);
      } else if (tier === 'content_only' && s.contentAccessEndDate) {
        daysRemaining = diffDays(todayIso, s.contentAccessEndDate);
      } else if (tier === 'none') {
        daysRemaining = 0;
      }

      return {
        tier,
        status: tier,
        courseId: s.courseId,
        plan: s.planName,
        hasSubscription: s.hasSubscription,
        subscriptionId: s.subscriptionId,
        endDate: s.endDate,
        graceEndDate: s.graceEndDate,
        contentAccessEndDate: s.contentAccessEndDate,
        daysRemaining,
        isTrial: s.isTrial,
        canJoinLive: live.allowed,
        canViewRecorded: content.allowed,
        canDownloadNotes: content.allowed,
        canOpenPdf: content.allowed,
        canAccessCourseLesson: content.allowed,
        canAccessPyq: content.allowed,
        canAttemptMockTests: content.allowed,
        canAttemptPracticeTest: content.allowed,
      };
    },
  };
}

// Convenience one-shot helpers (each performs its own load; prefer the
// checker when calling multiple methods in one request).
export async function checkCanJoinLiveClass(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  today?: string,
): Promise<AccessDecision> {
  return createSubscriptionAccessChecker(supabase, profileId).canJoinLiveClass(today);
}

export async function getSubscriptionAccessSummary(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  courseId?: string | null,
  userClient?: ReturnType<typeof createClient> | null,
  today?: string,
): Promise<SubscriptionAccessSummary> {
  return createSubscriptionAccessChecker(supabase, profileId, courseId, userClient).getSubscriptionAccessSummary(today);
}
