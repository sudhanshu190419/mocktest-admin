/**
 * Student ID Resolver
 *
 * Single source of truth for the profile_id → student_details.student_id mapping.
 * Every service that writes a student_id column must use this helper to ensure
 * RLS policies that join on student_details.profile_id = auth.uid() pass.
 *
 * ## Schema Context
 *
 * `mock_attempts.student_id` is an FK to `student_details.student_id`, NOT
 * `profiles.profile_id`.  The RLS policy for `mock_attempts` checks:
 *
 *   student_id = (
 *     SELECT student_id FROM student_details WHERE profile_id = auth.uid()
 *   )
 *
 * Therefore every INSERT must use the resolved `student_details.student_id`
 * value — never `auth.uid()` directly.
 *
 * @module studentResolver
 */

import { supabase } from '../../config/supabase';

/**
 * Result of a successful student resolution.
 */
export interface ResolvedStudent {
  /** The authenticated user's profile_id from the session. */
  profileId: string;
  /** The resolved student_details.student_id. */
  studentId: string;
}

/**
 * Resolves the authenticated user's student_details.student_id from their
 * session profile_id.
 *
 * @returns A `ResolvedStudent` object, or `null` if no active session or
 *          no student_details record exists for the authenticated user.
 *
 * @example
 * const resolved = await resolveCurrentStudentId();
 * if (!resolved) {
 *   return { success: false, error: 'No student profile exists.' };
 * }
 * console.log(resolved.studentId); // the correct student_id to use
 */
export async function resolveCurrentStudentId(): Promise<ResolvedStudent | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const profileId = sessionData?.session?.user?.id;

  if (!profileId) {
    return null;
  }

  const { data: studentRecord } = await supabase
    .from('student_details')
    .select('student_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!studentRecord) {
    return null;
  }

  return { profileId, studentId: studentRecord.student_id };
}
