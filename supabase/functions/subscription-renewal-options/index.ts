// ============================================================================
// Edge Function: subscription-renewal-options
//
// Phase 11K.3 — Renewal Eligibility & Plan Selection API (backend only).
//
// Determines what renewal options a student has for ONE course, following the
// finalized Phase 11K business rules:
//
//   1. A student may initially purchase ANY subscription plan.
//   2. After the initial purchase they are LOCKED to that billing cycle.
//   3. Renewal must only ever offer the SAME plan (Monthly → Monthly, etc.).
//   4. The only alternative is "Convert to Full Course" (one-time purchase of
//      the course, paying only the remaining amount).
//   5. Switching Monthly ↔ Quarterly ↔ Half-Yearly ↔ Yearly is NEVER allowed
//      once a subscription has been purchased.
//
// This endpoint does NOT perform payments, renewals, conversions, or any
// state change — it only reports what the student MAY do next.
//
// ── Authentication ─────────────────────────────────────────────────────────
// verify_jwt = true (default) — the caller must be authenticated. The
// caller's role is resolved authoritatively from profiles (never from a
// client-supplied value).
//
// ── Request ────────────────────────────────────────────────────────────────
//   GET  /functions/v1/subscription-renewal-options?courseId=<uuid>
//   POST /functions/v1/subscription-renewal-options   (body: { courseId })
//
//   courseId is REQUIRED — renewal options are course-scoped (Phase 11G/11H).
//
// ── Response (success) ─────────────────────────────────────────────────────
// {
//   "success": true,
//   "data": {
//     "courseId": "uuid",
//     "canRenew": true,
//     "renewalPlan": { ...current plan + current subscription context... },
//     "canConvertToFullCourse": true,
//     "remainingAmount": 7000.00,
//     "otherPlans": []
//   }
// }
//
//   • renewalPlan          — ALWAYS the student's CURRENT subscription plan
//                            for this course (never a historical plan, never
//                            a different billing cycle). null when the
//                            student has no subscription for the course.
//   • otherPlans           — ALWAYS [] (billing-cycle locking).
//   • remainingAmount      — (discounted_price ?? original_price) −
//                            total_subscription_payments(student_id, course_id)
//                            clamped at 0. Computed ONLY when the course is
//                            convertible (published, priced, not deleted,
//                            not already permanently owned); otherwise null.
//   • canRenew             — true when the student has a current subscription
//                            for the course and does not already permanently
//                            own it.
//   • canConvertToFullCourse — true when the student has a current
//                            subscription, does not already permanently own
//                            the course, and the course is one-time
//                            purchasable (same validations as
//                            create-payment-order).
//
// ── Non-student callers ────────────────────────────────────────────────────
// admin / teacher are NOT subscription-gated: the endpoint returns a benign
// empty response (canRenew=false, renewalPlan=null, ...) since staff never
// hold a student subscription for renewal purposes.
//
// ── Data sources ───────────────────────────────────────────────────────────
//   • student_subscriptions  — current subscription row for (student, course).
//   • subscription_plans     — the renewal plan + unlocked features.
//   • courses                — course price basis for the conversion amount.
//   • course_enrollments     — permanent-ownership check (enrollment_type =
//                              'purchase', is_active) — matches migration 096.
//   • total_subscription_payments(student_id, course_id) — SQL helper from
//     migration 096 (SECURITY DEFINER) called via RPC with the service-role
//     client; it reads immutable orders/order_items billing history, so it is
//     correct under the revised renewal architecture (single
//     student_subscriptions row updated in place).
//
// ── Environment Variables ──────────────────────────────────────────────────
// SUPABASE_URL              — Auto-injected by Supabase
// SUPABASE_ANON_KEY         — Auto-injected by Supabase (auth verification)
// SUPABASE_SERVICE_ROLE_KEY — Auto-injected by Supabase (DB reads)
//
// @module edge-functions/subscription-renewal-options
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isStaffRole } from '../_shared/subscriptionAccess.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// ─── Structured Logging ─────────────────────────────────────────────────────

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'subscription-renewal-options',
      event,
      ...data,
    }),
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, status = 500, code?: string, details?: string): Response {
  structuredLog('RENEWAL_OPTIONS_ERROR', { error, statusCode: status, code, details });
  return jsonResponse(
    {
      success: false,
      error,
      ...(code ? { code } : {}),
      ...(details ? { details } : {}),
    },
    status,
  );
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Effective course price — MUST match create-payment-order.getCourseEffectivePrice()
 * exactly so the Full Course conversion amount equals what a one-time buyer
 * pays today (Phase 11K.1 decision D1: zero divergence).
 */
function getCourseEffectivePrice(course: {
  original_price: number | string;
  discounted_price: number | string | null;
}): number {
  return (course.discounted_price != null && Number(course.discounted_price) > 0)
    ? Number(course.discounted_price)
    : Number(course.original_price);
}

/** Benign empty options payload (non-student, no subscription, or owned). */
function emptyOptions(courseId: string, remainingAmount: number | null = null) {
  return {
    courseId,
    canRenew: false,
    renewalPlan: null,
    canConvertToFullCourse: false,
    remainingAmount,
    otherPlans: [],
  };
}

// ─── Row shapes (service-role reads — RLS bypassed) ─────────────────────────

interface SubscriptionRow {
  subscription_id: string;
  student_id: string;
  institute_id: string;
  plan_id: string;
  course_id: string;
  status: string;
  end_date: string | null;
  grace_end_date: string | null;
  content_access_end_date: string | null;
  is_trial: boolean;
  created_at: string;
}

interface PlanUnlockRow {
  is_enabled: boolean;
  subscription_features: {
    feature_key: string;
    display_name: string;
    description: string | null;
  } | null;
}

interface PlanRow {
  plan_id: string;
  course_id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number | string;
  currency_code: string;
  billing_cycle: string;
  duration_days: number;
  trial_days: number;
  is_featured: boolean;
  sort_order: number;
  is_active: boolean;
  plan_unlocks: PlanUnlockRow[] | null;
}

interface CourseRow {
  course_id: string;
  institute_id: string;
  title: string;
  original_price: number | string;
  discounted_price: number | string | null;
  currency: string;
  status: string;
  deleted_at: string | null;
}

// ─── Main Handler ──────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS preflight ──────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse('Method not allowed. Use GET or POST.', 405);
  }

  structuredLog('RENEWAL_OPTIONS_REQUEST', { method: req.method });

  try {
    // ── courseId (required) — query param takes precedence over body ──
    let courseId: string | null = null;
    try {
      const url = new URL(req.url);
      courseId = url.searchParams.get('courseId');
    } catch {
      courseId = null;
    }
    if (!courseId && req.method === 'POST') {
      try {
        const body = (await req.json()) as { courseId?: string };
        courseId = body.courseId ?? null;
      } catch {
        courseId = null;
      }
    }

    if (!courseId) {
      return errorResponse('courseId is required to compute renewal options.', 400, 'COURSE_ID_REQUIRED');
    }

    structuredLog('RENEWAL_OPTIONS_COURSE_SCOPE', { courseId });

    // ── Init Supabase clients ─────────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return errorResponse('Server configuration error.', 500);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authentication required. Provide a valid Bearer token.', 401);
    }

    // Anon client forwards the caller's JWT so getUser() resolves correctly.
    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });

    // Service-role client for authoritative DB reads (same pattern as the
    // commerce and subscription-access-status functions).
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // ── Resolve the authenticated user + authoritative role ───────────
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) {
      structuredLog('AUTH_FAILED', {
        error: userError?.message ?? 'No user returned from getUser()',
      });
      return errorResponse('Invalid or expired authentication token.', 401);
    }

    const userId = userData.user.id;
    structuredLog('AUTH_SUCCESS', { userId });

    const { data: profile } = await adminClient
      .from('profiles')
      .select('role')
      .eq('profile_id', userId)
      .maybeSingle();

    const role = (profile?.role as string | undefined) ?? 'student';

    // Staff (admin / teacher) are NOT subscription-gated → benign empty
    // options. The 'user' role (pre-purchase placeholder, migration 046)
    // follows the normal student path below.
    if (isStaffRole(role)) {
      structuredLog('ROLE_BYPASS', { userId, role });
      return jsonResponse({ success: true, data: emptyOptions(courseId) });
    }

    // ── Resolve student_id ────────────────────────────────────────────
    const { data: student } = await adminClient
      .from('student_details')
      .select('student_id, institute_id')
      .eq('profile_id', userId)
      .maybeSingle();

    if (!student) {
      structuredLog('NO_STUDENT_DETAILS', { userId });
      return jsonResponse({ success: true, data: emptyOptions(courseId) });
    }

    const studentId = (student as { student_id: string }).student_id;

    // ── Validate the course (mirror create-payment-order) ─────────────
    const { data: course, error: courseError } = await adminClient
      .from('courses')
      .select('course_id, original_price, discounted_price, status, deleted_at')
      .eq('course_id', courseId)
      .maybeSingle();

    if (courseError || !course) {
      // Raw PostgREST message is logged server-side only (RENEWAL_OPTIONS_ERROR
      // already captures it) — never surfaced to the client.
      return errorResponse('Course not found.', 404, 'COURSE_NOT_FOUND');
    }

    const courseRow = course as CourseRow;
    if (courseRow.deleted_at) {
      return errorResponse('This course is no longer available.', 410, 'COURSE_DELETED');
    }

    // ── Permanent-ownership check (migration 096 semantics) ───────────
    const { data: ownedEnrollment } = await adminClient
      .from('course_enrollments')
      .select('enrollment_id')
      .eq('course_id', courseId)
      .eq('student_id', studentId)
      .eq('enrollment_type', 'purchase')
      .eq('is_active', true)
      .maybeSingle();

    const permanentlyOwned = !!ownedEnrollment;
    structuredLog('OWNERSHIP_CHECK', { studentId, courseId, permanentlyOwned });

    if (permanentlyOwned) {
      // The student already permanently owns the course — nothing to renew
      // and nothing left to pay for conversion.
      return jsonResponse({
        success: true,
        data: emptyOptions(courseId, 0),
      });
    }

    // ── Load the CURRENT subscription for (student, course) ───────────
    // Phase 11K.1 decision D3: the renewal plan is determined by the
    // student's CURRENT subscription record for the course — never a
    // historical subscription. Selection mirrors loadSubscriptionAccessState:
    // active/grace row wins, else expired-with-content-window, else newest.
    const { data: subs } = await adminClient
      .from('student_subscriptions')
      .select(
        'subscription_id, student_id, institute_id, plan_id, course_id, status, end_date, grace_end_date, content_access_end_date, is_trial, created_at',
      )
      .eq('student_id', studentId)
      .eq('course_id', courseId)
      .order('created_at', { ascending: false })
      .limit(50);

    const rows = (subs ?? []) as SubscriptionRow[];
    if (rows.length === 0) {
      // No subscription for this course → no renewal / conversion options;
      // the student should use the initial plans screen instead.
      return jsonResponse({ success: true, data: emptyOptions(courseId) });
    }

    const today = todayUtc();
    const current: SubscriptionRow =
      rows.find((r) => r.status === 'active' || r.status === 'grace') ??
      rows.find(
        (r) =>
          r.status === 'expired' &&
          r.content_access_end_date !== null &&
          r.content_access_end_date >= today,
      ) ??
      rows[0];

    structuredLog('CURRENT_SUBSCRIPTION', {
      studentId,
      courseId,
      subscriptionId: current.subscription_id,
      status: current.status,
      planId: current.plan_id,
    });

    // ── Load the renewal plan (with unlocked features) ────────────────
    const { data: plan, error: planError } = await adminClient
      .from('subscription_plans')
      .select(
        'plan_id, course_id, name, slug, description, price, currency_code, billing_cycle, duration_days, trial_days, is_featured, sort_order, plan_unlocks ( is_enabled, subscription_features ( feature_key, display_name, description ) )',
      )
      .eq('plan_id', current.plan_id)
      .maybeSingle();

    if (planError || !plan) {
      // Raw PostgREST message is logged server-side only — never surfaced.
      return errorResponse('Current subscription plan not found.', 404, 'PLAN_NOT_FOUND');
    }

    const planRow = plan as PlanRow;
    const features = (planRow.plan_unlocks ?? [])
      .filter((u) => u.is_enabled && u.subscription_features)
      .map((u) => ({
        featureKey: u.subscription_features!.feature_key,
        displayName: u.subscription_features!.display_name,
        description: u.subscription_features!.description ?? null,
      }));

    // ── Conversion eligibility (mirror create-payment-order) ──────────
    // Valid purchasable course = published AND (original_price > 0 OR
    // discounted_price > 0). Parentheses are deliberate — `&&` binds tighter
    // than `||`.
    const courseConvertible =
      courseRow.status === 'published' &&
      (Number(courseRow.original_price) > 0 ||
        (courseRow.discounted_price != null && Number(courseRow.discounted_price) > 0));

    const canConvertToFullCourse = courseConvertible;

    // ── Remaining amount for Full Course conversion ───────────────────
    // (discounted_price ?? original_price) − total_subscription_payments.
    // The payment total comes from the migration 096 SECURITY DEFINER helper
    // via RPC (service-role call → auth.role() = 'service_role' → allowed).
    let remainingAmount: number | null = null;
    if (canConvertToFullCourse) {
      const { data: totalPaidRaw, error: totalPaidError } = await adminClient.rpc(
        'total_subscription_payments',
        { p_student_id: studentId, p_course_id: courseId },
      );

      if (totalPaidError) {
        structuredLog('TOTAL_SUBSCRIPTION_PAYMENTS_ERROR', {
          studentId,
          courseId,
          error: totalPaidError.message,
          sqlState: (totalPaidError as { code?: string })?.code ?? 'unknown',
        });
        return errorResponse('Unable to compute the renewal amount. Please try again.', 500, 'PRICING_UNAVAILABLE');
      }

      const totalPaid = Number(totalPaidRaw ?? 0);
      const effectivePrice = getCourseEffectivePrice(courseRow);
      remainingAmount = Math.max(0, Math.round((effectivePrice - totalPaid) * 100) / 100);

      structuredLog('REMAINING_AMOUNT_COMPUTED', {
        studentId,
        courseId,
        effectivePrice,
        totalPaid,
        remainingAmount,
      });
    }

    // ── Build the response ────────────────────────────────────────────
    const data = {
      courseId,
      canRenew: true,
      renewalPlan: {
        planId: planRow.plan_id,
        courseId: planRow.course_id,
        name: planRow.name,
        slug: planRow.slug,
        description: planRow.description ?? null,
        price: Number(planRow.price),
        currencyCode: planRow.currency_code?.trim() || 'INR',
        billingCycle: planRow.billing_cycle,
        durationDays: planRow.duration_days,
        trialDays: planRow.trial_days,
        isFeatured: planRow.is_featured,
        sortOrder: planRow.sort_order,
        isActive: planRow.is_active,
        features,
        subscription: {
          subscriptionId: current.subscription_id,
          status: current.status,
          endDate: current.end_date,
          graceEndDate: current.grace_end_date,
          contentAccessEndDate: current.content_access_end_date,
          isTrial: current.is_trial,
        },
      },
      canConvertToFullCourse,
      remainingAmount,
      otherPlans: [],
    };

    structuredLog('RENEWAL_OPTIONS_COMPLETE', {
      userId,
      courseId,
      canRenew: data.canRenew,
      renewalPlan: planRow.name,
      canConvertToFullCourse,
      remainingAmount,
    });

    return jsonResponse({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    structuredLog('UNEXPECTED_ERROR', {
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return errorResponse('An unexpected error occurred.', 500);
  }
});
