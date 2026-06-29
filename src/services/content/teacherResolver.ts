/**
 * Teacher ID Resolver
 *
 * Single source of truth for the profile_id → teacher_details.teacher_id mapping.
 * Every service that writes a teacher_id or tagged_by column must use this helper
 * to ensure RLS policies that join on teacher_details.profile_id = auth.uid() pass.
 *
 * @module teacherResolver
 */

import { supabase } from '../../config/supabase';

/**
 * Result of a successful teacher resolution.
 */
export interface ResolvedTeacher {
  /** The authenticated user's profile_id from the session. */
  profileId: string;
  /** The resolved teacher_details.teacher_id. */
  teacherId: string;
}

/**
 * Resolves the authenticated user's teacher_details.teacher_id from their
 * session profile_id.
 *
 * @returns A `ResolvedTeacher` object, or `null` if no active session or
 *          no teacher_details record exists for the authenticated user.
 *
 * @example
 * const resolved = await resolveCurrentTeacherId();
 * if (!resolved) {
 *   return { success: false, error: 'No teacher profile exists.' };
 * }
 * console.log(resolved.teacherId); // the correct teacher_id to use
 */
export async function resolveCurrentTeacherId(): Promise<ResolvedTeacher | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const profileId = sessionData?.session?.user?.id;

  if (!profileId) {
    return null;
  }

  const { data: teacherRecord } = await supabase
    .from('teacher_details')
    .select('teacher_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!teacherRecord) {
    return null;
  }

  return { profileId, teacherId: teacherRecord.teacher_id };
}
