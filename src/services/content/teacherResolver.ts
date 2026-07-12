/**
 * Teacher ID Resolver
 *
 * Delegates to the centralised `teacherIdentity` resolver. All teacher identity
 * resolution now flows through `src/services/teacherIdentity.ts`, which provides
 * a single source of truth for { profileId, teacherId, instituteId }.
 *
 * This file is kept for backward compatibility with existing callers (questionService,
 * mockTestService). New code should import from `@/services/teacherIdentity` directly.
 *
 * @module teacherResolver
 * @see module:teacherIdentity
 */

import {
  resolveTeacherIdentity,
  type TeacherIdentity,
} from '../teacherIdentity';

/**
 * @deprecated Use `TeacherIdentity` from `@/services/teacherIdentity` instead.
 */
export interface ResolvedTeacher {
  /** The authenticated user's profile_id from the session. */
  profileId: string;
  /** The resolved teacher_details.teacher_id. */
  teacherId: string;
}

/**
 * Resolves the authenticated user's teacher identity.
 *
 * Delegates to `resolveTeacherIdentity()` in the centralised identity module.
 *
 * @returns A `ResolvedTeacher` object, or `null` if no active session or
 *          no teacher_details record exists.
 *
 * @example
 * const resolved = await resolveCurrentTeacherId();
 * if (!resolved) {
 *   return { success: false, error: 'No teacher profile exists.' };
 * }
 * console.log(resolved.teacherId); // the correct teacher_id to use
 */
export async function resolveCurrentTeacherId(): Promise<ResolvedTeacher | null> {
  const identity = await resolveTeacherIdentity();
  if (!identity) {
    return null;
  }
  return { profileId: identity.profileId, teacherId: identity.teacherId };
}

