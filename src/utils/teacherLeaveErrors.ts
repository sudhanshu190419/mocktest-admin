/**
 * Teacher Leave + Class Resolution — RPC Error Mapping
 *
 * Maps known migration-115 `raise exception` messages to friendly frontend
 * text. Unknown messages pass through verbatim (the RPC messages are already
 * user-safe English), so debugging stays possible and we never fabricate
 * row-level failure information.
 *
 * The mapping is substring-based against the real messages raised in
 * supabase/migrations/115_teacher_leave_resolution.sql. Order matters —
 * more specific patterns are checked first.
 *
 * @module utils/teacherLeaveErrors
 */

/** Generic fallback when the RPC returned no usable message. */
const FALLBACK = 'Something went wrong. Please try again.';

/**
 * Translate a migration-115 RPC error message into a friendly UI message.
 *
 * @param message - The raw RPC/PostgREST error message.
 * @returns A user-safe message (the original message when unmapped).
 */
export function leaveRequestErrorMessage(message: string): string {
  const raw = (message ?? '').trim();
  if (!raw) return FALLBACK;

  const m = raw.toLowerCase();

  // ── Permission / ownership (never trust a client decision) ─────────
  if (
    m.includes('only teachers can submit leave requests') ||
    m.includes('only teachers can cancel leave requests') ||
    m.includes('only academic or super admins can review leave requests') ||
    m.includes('only academic or super admins can resolve classes') ||
    m.includes('only academic or super admins can cancel resolutions') ||
    m.includes('only admins or the service role can reconcile') ||
    m.includes('for your own institute') ||
    m.includes('is not an active slot of yours in this institute') ||
    m.includes('you can only cancel your own leave requests')
  ) {
    return "You don't have permission to perform this action.";
  }

  if (m.includes('teacher identity could not be resolved')) {
    return 'Your teacher profile could not be identified. Please contact the administrator.';
  }

  // ── Leave cannot cover a live/completed class (submission time) ────
  if (m.includes('leave cannot cover a live or completed class')) {
    return 'Leave cannot cover a class that is already live or completed.';
  }

  // ── Not in a scheduled state (checked BEFORE the generic
  //    started/substitute/reschedule branches — the real message combines
  //    both, e.g. "not in a scheduled state; it cannot be substituted").
  if (m.includes('is not in a scheduled state')) {
    return 'This class is no longer in a scheduled state and cannot be changed.';
  }

  // ── Already started / live / completed (class cannot change) ───────
  if (
    m.includes('has already started') ||
    m.includes('now has a live/completed class') ||
    m.includes('cannot be substituted') ||
    m.includes('cannot be rescheduled')
  ) {
    return 'This class can no longer be changed — it has already started or finished.';
  }

  if (m.includes('the affected occurrence has already passed')) {
    return 'This class has already passed and can no longer be changed.';
  }

  if (m.includes('was cancelled manually and cannot be revived')) {
    return 'This class was cancelled manually and cannot be revived through this action.';
  }

  if (m.includes('the rescheduled time must be in the future')) {
    return 'The new class time must be in the future.';
  }

  // ── Already handled (state machine guards) ─────────────────────────
  if (m.includes('only pending leave requests can be reviewed')) {
    return 'This request has already been handled.';
  }

  if (m.includes('only pending leave requests can be cancelled')) {
    return 'Only pending requests can be cancelled.';
  }

  if (
    m.includes('resolution is not pending') ||
    m.includes('another active resolution already exists for the target date')
  ) {
    return 'This class has already been handled.';
  }

  if (m.includes('only pending resolutions can be cancelled')) {
    return 'This resolution has already been handled.';
  }

  // ── No upcoming classes in the requested range ─────────────────────
  if (
    m.includes('no timetable slots found for the requested date range') ||
    m.includes('no class occurrences fall inside the requested date range')
  ) {
    return 'No upcoming classes were found for the selected dates.';
  }

  // ── Substitute-teacher availability ────────────────────────────────
  if (m.includes('teacher is not assigned to this batch subject')) {
    return 'The selected teacher is not assigned to this batch subject.';
  }

  if (
    m.includes('teacher is on leave on this date') ||
    m.includes('substitute teacher is not active') ||
    m.includes('substitute teacher not found in this institute') ||
    m.includes('teacher already has a live class in this time window') ||
    m.includes('teacher conflict')
  ) {
    return 'The selected teacher is unavailable at this time.';
  }

  // ── Batch conflict ─────────────────────────────────────────────────
  if (m.includes('the batch already has a live class in this time window')) {
    return 'The batch already has another class at this time.';
  }

  // ── Holiday conflict ───────────────────────────────────────────────
  if (m.includes('the occurrence date is an institute holiday')) {
    return 'The chosen time falls on a holiday or teacher leave.';
  }

  // ── Input validation / resource lookups ────────────────────────────
  if (m.includes('a valid leave date range')) {
    return 'Please choose a valid date range (start on or before end).';
  }

  if (m.includes('a valid future date with start < end')) {
    return 'The new class time must be valid and in the future.';
  }

  if (m.includes('mock test not found or not published in this institute')) {
    return 'The selected mock test is not available in this institute.';
  }

  if (m.includes('recording not found or not ready in this institute')) {
    return 'The selected recording is not available in this institute.';
  }

  if (m.includes('a class already exists for this timetable on the target date')) {
    return 'A class already exists at the new time — choose a different slot.';
  }

  if (
    m.includes('could not create the rescheduled occurrence') ||
    m.includes('could not create the substitute occurrence')
  ) {
    return 'The class could not be created due to a scheduling conflict. Please try a different time.';
  }

  if (
    m.includes('leave request not found') ||
    m.includes('resolution not found') ||
    m.includes('timetable slot not found') ||
    m.includes('referenced live class not found')
  ) {
    return 'The record could not be found. It may have been removed.';
  }

  // ── Unknown: surface the RPC's own (user-safe) message ─────────────
  return raw;
}
