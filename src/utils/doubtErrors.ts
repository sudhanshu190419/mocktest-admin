/**
 * Doubt System — RPC Error Mapping
 *
 * Maps known migration-117 `raise exception` messages to friendly frontend
 * text. Unknown messages pass through verbatim (the RPC messages are already
 * user-safe English), so debugging stays possible and we never fabricate
 * row-level failure information.
 *
 * The mapping is substring-based against the real messages raised in
 * supabase/migrations/117_doubt_system.sql. Order matters — more specific
 * patterns are checked first.
 *
 * @module utils/doubtErrors
 */

/** Generic fallback when the RPC returned no usable message. */
const FALLBACK = 'Something went wrong. Please try again.';

/**
 * Translate a migration-117 RPC error message into a friendly UI message.
 *
 * @param message - The raw RPC/PostgREST error message.
 * @returns A user-safe message (the original message when unmapped).
 */
export function doubtErrorMessage(message: string): string {
  const raw = (message ?? '').trim();
  if (!raw) return FALLBACK;

  const m = raw.toLowerCase();

  // ── Permission / ownership (never trust a client decision) ─────────
  if (
    m.includes('only students can submit doubts') ||
    m.includes('only academic admins can assign teachers to doubts') ||
    m.includes('only academic admins can archive doubts') ||
    m.includes('only the doubt owner can accept an answer') ||
    m.includes('you do not have access to this doubt') ||
    m.includes('you do not have access to doubts in this institute') ||
    m.includes('authentication required')
  ) {
    return "You don't have permission to perform this action.";
  }

  // ── Archived / terminal state (cannot modify) ──────────────────────
  if (m.includes('archived and can no longer be modified')) {
    return 'This doubt is archived and can no longer be modified.';
  }
  if (m.includes('doubt is already archived')) {
    return 'This doubt is already archived.';
  }
  if (m.includes('archived doubts cannot be assigned')) {
    return 'Archived doubts cannot be assigned.';
  }
  if (m.includes('resolved doubts cannot be reassigned')) {
    return 'This doubt is already resolved and cannot be reassigned.';
  }

  // ── Status-transition guards ───────────────────────────────────────
  if (m.includes('only resolved doubts can be reopened')) {
    return 'Only resolved doubts can be reopened.';
  }
  if (m.includes('reopened the maximum number of times')) {
    return 'This doubt has been reopened the maximum number of times (3).';
  }
  if (
    m.includes('doubt cannot be resolved from its current state') ||
    m.includes('doubt cannot be reopened from its current state')
  ) {
    return 'This doubt cannot be changed in its current state.';
  }

  // ── Input validation (submit_student_doubt) ────────────────────────
  if (m.includes('a subject is required for the doubt')) {
    return 'Please choose a subject for your doubt.';
  }
  if (m.includes('doubt title must be 5-200 characters')) {
    return 'The doubt title must be between 5 and 200 characters.';
  }
  if (m.includes('doubt description is required')) {
    return 'Please describe your doubt.';
  }
  if (m.includes('reply text is required')) {
    return 'Please write a reply before submitting.';
  }
  if (m.includes('topic requires a chapter')) {
    return 'Please choose a chapter before selecting a topic.';
  }

  // ── Resource lookup / consistency (submit_student_doubt) ───────────
  if (m.includes('subject not found')) {
    return 'The selected subject could not be found.';
  }
  if (
    m.includes('chapter not found') ||
    m.includes('chapter does not belong to the selected subject')
  ) {
    return 'The selected chapter is not valid for this subject.';
  }
  if (
    m.includes('topic not found') ||
    m.includes('topic does not belong to the selected chapter')
  ) {
    return 'The selected topic is not valid for this chapter.';
  }
  if (m.includes('batch subject not found')) {
    return 'The selected batch subject could not be found.';
  }
  if (m.includes('batch subject is not active')) {
    return 'This batch subject is currently inactive.';
  }
  if (m.includes('batch subject does not belong to your institute')) {
    return 'The selected batch subject does not belong to your institute.';
  }
  if (m.includes('the subject does not match the selected batch subject')) {
    return 'The subject does not match the selected batch subject.';
  }
  if (m.includes('you are not enrolled in the batch for this subject')) {
    return "You're not enrolled in the batch for this subject.";
  }
  if (m.includes('not part of any of your active batches')) {
    return 'This subject is not available in any of your active batches.';
  }
  if (m.includes('belongs to multiple of your batches')) {
    return 'This subject belongs to multiple of your batches. Please choose the specific batch subject.';
  }

  // ── Reply / answer validation ──────────────────────────────────────
  if (m.includes('reply does not belong to this doubt')) {
    return 'This reply does not belong to the doubt.';
  }
  if (m.includes('only a teacher') && m.includes('can be accepted as the solution')) {
    return "Only a teacher's answer can be accepted as the solution.";
  }

  // ── Assignment validation ──────────────────────────────────────────
  if (m.includes('teacher not found')) {
    return 'The selected teacher could not be found.';
  }
  if (m.includes('the selected teacher is not active')) {
    return 'The selected teacher is not active.';
  }
  if (m.includes('not assigned to this subject/batch')) {
    return 'The selected teacher is not assigned to this subject or batch.';
  }

  // ── Attachments ────────────────────────────────────────────────────
  if (m.includes('unsupported file type')) {
    return 'Unsupported file type. Only JPEG, PNG, WEBP and PDF are allowed.';
  }
  if (m.includes('file must be between 1 byte and 25 mb')) {
    return 'Files must be between 1 byte and 25 MB.';
  }

  // ── Not found / no access (generic) ────────────────────────────────
  // PGRST116 is PostgREST's "JSON object requested, multiple (or no) rows
  // returned" — what `.single()` returns when RLS filters the doubt out.
  if (m.includes('doubt not found') || m.includes('multiple (or no) rows')) {
    return 'The doubt could not be found. It may have been removed.';
  }

  // ── Unknown: surface the RPC's own (user-safe) message ─────────────
  return raw;
}
