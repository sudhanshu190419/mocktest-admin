// ============================================================================
// Shared Helper: Course Enrollment Sync (Phase 11I.2)
//
// PostgreSQL 16 | Supabase Edge Runtime | Production Ready
//
// Idempotent course_enrollments sync for commerce Edge Functions.
//
// Mirrors the enrollment behavior of complete-course-purchase so every
// purchase path (one-time OR subscription) produces EXACTLY ONE active
// course_enrollments row per (student_id, course_id):
//
//   • No enrollment  → INSERT (enrollment_type caller-supplied; for
//                      subscription purchases: 'subscription').
//   • Enrollment     → reactivate (is_active = true, clear revocation
//                      fields). NEVER inserts a duplicate and NEVER
//                      overwrites unrelated purchase history (enrollment_type,
//                      order_item_id, enrolled_at, progress_percent, ... are
//                      left untouched).
//
// Renewals reuse the same row — a second subscription purchase for the same
// course only re-activates the existing enrollment.
//
// Expiry is deliberately NOT handled here: when a subscription expires the
// enrollment row is KEPT. Access revocation is enforced by the entitlement
// helpers / RLS / Edge Functions (Phases 11G–11J), never by deleting or
// deactivating the enrollment. The row represents "the student was enrolled
// in this course at some point" (audit/history semantics), which is exactly
// what dashboards, My Courses and analytics consume.
//
// Error handling: the caller decides whether an enrollment failure is fatal.
// This helper never throws — it returns null on failure so the purchase flow
// can decide (subscription flows treat it as non-fatal, matching the
// subscription_history / orders.linking behavior).
//
// ⚠️ ADOPTION CAVEAT — do NOT blindly wire this helper into
// complete-course-purchase: its existing-enrollment path currently EARLY-
// RETURNS "already enrolled" WITHOUT re-activating, whereas this helper
// RE-ACTIVATES (is_active=true + clears revocation). Adopting it there would
// silently change behavior (e.g. re-activating a revoked purchase enrollment).
// Adopt it into complete-course-purchase only after an explicit product
// decision to unify the reactivation semantics. For now it serves the
// subscription purchase flow (Phase 11I.2).
//
// @module _shared/courseEnrollment
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface SyncCourseEnrollmentParams {
  studentId: string;
  courseId: string;
  instituteId: string;
  /** enrollment_type value written only when a NEW row is created. */
  enrollmentType: string;
}

export interface SyncCourseEnrollmentResult {
  /** Whether a new enrollment row was created. */
  created: boolean;
  /** The (existing or new) enrollment_id. */
  enrollmentId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════════════════════════════════════

function structuredLog(event: string, data: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      service: 'course-enrollment-sync',
      event,
      ...data,
    }),
  );
}

function structuredError(event: string, data: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      service: 'course-enrollment-sync',
      event,
      ...data,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Idempotently ensure a course_enrollments row exists and is active for the
 * given (student_id, course_id).
 *
 *   • Row missing   → INSERT with the supplied enrollment_type (is_active
 *                     defaults to true).
 *   • Row exists    → re-activate in place: is_active = true and revocation
 *                     fields cleared. enrollment_type / order_item_id /
 *                     progress / timestamps are preserved (no history loss).
 *                     The (course_id, student_id) UNIQUE constraint
 *                     (migration 034) guarantees a concurrent double-insert
 *                     cannot produce duplicates.
 *
 * @param client         - Service-role (or otherwise privileged) Supabase
 *                         client used for the write.
 * @param params         - studentId / courseId / instituteId / enrollmentType.
 *
 * @returns { created, enrollmentId } on success, or null on failure. Never
 *          throws — the caller decides whether failure is fatal.
 */
export async function syncCourseEnrollment(
  client: ReturnType<typeof createClient>,
  params: SyncCourseEnrollmentParams,
): Promise<SyncCourseEnrollmentResult | null> {
  const { studentId, courseId, instituteId, enrollmentType } = params;

  structuredLog('ENROLLMENT_SYNC_START', {
    studentId,
    courseId,
    instituteId,
    enrollmentType,
  });

  // ── 1. Look for an existing row (UNIQUE (course_id, student_id)) ─────
  const { data: existing } = await client
    .from('course_enrollments')
    .select('enrollment_id')
    .eq('course_id', courseId)
    .eq('student_id', studentId)
    .maybeSingle();

  // ── 2. Existing row → re-activate in place (never duplicate, never
  //        overwrite purchase history). ─────────────────────────────────
  if (existing) {
    // Read the row's current activation state so renewals/webhook retries on
    // an already-active row skip the write entirely (avoid redundant UPDATEs
    // on the hottest path). Only rows that are inactive or still carry
    // revocation markers need an UPDATE.
    const { data: current } = await client
      .from('course_enrollments')
      .select('is_active, revoked_at, revoked_by, revoked_reason')
      .eq('enrollment_id', existing.enrollment_id)
      .maybeSingle();

    const needsReactivate =
      !current ||
      !current.is_active ||
      current.revoked_at !== null ||
      current.revoked_by !== null ||
      current.revoked_reason !== null;

    if (needsReactivate) {
      const { error: reactivateError } = await client
        .from('course_enrollments')
        .update({
          is_active: true,
          // Revocation CHECK constraint (migration 034) requires revocation
          // fields to be NULL when is_active = true — clear them so a
          // previously-revoked enrollment can be re-activated by a purchase.
          revoked_at: null,
          revoked_by: null,
          revoked_reason: null,
        })
        .eq('enrollment_id', existing.enrollment_id);

      if (reactivateError) {
        structuredError('ENROLLMENT_REACTIVATE_FAILED', {
          studentId,
          courseId,
          enrollmentId: existing.enrollment_id,
          error: reactivateError.message,
          sqlState: (reactivateError as { code?: string })?.code ?? 'unknown',
        });
        return null;
      }

      structuredLog('ENROLLMENT_REACTIVATED', {
        studentId,
        courseId,
        enrollmentId: existing.enrollment_id,
        note: 'Reused existing row — no duplicate created, purchase history preserved',
      });
    } else {
      structuredLog('ENROLLMENT_ALREADY_ACTIVE', {
        studentId,
        courseId,
        enrollmentId: existing.enrollment_id,
        note: 'Existing enrollment already active — no write performed',
      });
    }

    return { created: false, enrollmentId: existing.enrollment_id };
  }

  // ── 3. No row → create it (same column set as complete-course-purchase:
  //        course_id / student_id / institute_id / enrollment_type;
  //        is_active defaults to true). ──────────────────────────────────
  const { data: inserted, error: insertError } = await client
    .from('course_enrollments')
    .insert({
      course_id: courseId,
      student_id: studentId,
      institute_id: instituteId,
      enrollment_type: enrollmentType,
    })
    .select('enrollment_id')
    .single();

  if (insertError) {
    // ── Concurrency recovery ───────────────────────────────────────────
    // A concurrent webhook delivery may have inserted the row between our
    // SELECT and this INSERT (UNIQUE (course_id, student_id) → 23505).
    // Re-read; if found, treat as reactivated (no duplicate, no error).
    const isUniqueViolation =
      (insertError as { code?: string })?.code === '23505' ||
      /duplicate key/i.test(insertError.message ?? '');

    if (isUniqueViolation) {
      const { data: raced } = await client
        .from('course_enrollments')
        .select('enrollment_id')
        .eq('course_id', courseId)
        .eq('student_id', studentId)
        .maybeSingle();

      if (raced) {
        structuredLog('ENROLLMENT_RACE_RECOVERED', {
          studentId,
          courseId,
          enrollmentId: raced.enrollment_id,
          note: 'Concurrent insert detected — reused existing row',
        });
        return { created: false, enrollmentId: raced.enrollment_id };
      }
    }

    structuredError('ENROLLMENT_INSERT_FAILED', {
      studentId,
      courseId,
      error: insertError.message,
      sqlState: (insertError as { code?: string })?.code ?? 'unknown',
    });
    return null;
  }

  structuredLog('ENROLLMENT_CREATED', {
    studentId,
    courseId,
    enrollmentId: inserted.enrollment_id,
    enrollmentType,
  });

  return { created: true, enrollmentId: inserted.enrollment_id };
}
