/**
 * Teacher Identity Resolver
 *
 * Single source of truth for teacher identity throughout the Teacher Dashboard.
 *
 * ## Purpose
 *
 * Every service in the Teacher Dashboard needs to query either `profiles` or
 * `teacher_details`. These two tables use DIFFERENT primary keys:
 *
 * - `profiles.profile_id` = `auth.users.id` (the Supabase Auth user UUID)
 * - `teacher_details.teacher_id` = a separate UUID (the teacher's record PK)
 * - `teacher_details.profile_id` = FK linking back to `profiles.profile_id`
 *
 * Passing the wrong ID to a query has been the root cause of multiple bugs
 * (PGRST116 errors, phantom 0-row updates, broken RLS). This helper ensures
 * every caller uses the correct identifier for the correct table.
 *
 * ## Usage
 *
 * ```ts
 * // In any service:
 * const identity = await resolveTeacherIdentity();
 * if (!identity) return { success: false, error: 'No teacher identity found.' };
 *
 * // Query profiles with the CORRECT key:
 * supabase.from('profiles').select('*').eq('profile_id', identity.profileId);
 *
 * // Query teacher_details with the CORRECT key:
 * supabase.from('teacher_details').select('*').eq('teacher_id', identity.teacherId);
 *
 * // Use instituteId for multi-tenant scoping:
 * supabase.from('questions').select('*').eq('institute_id', identity.instituteId);
 * ```
 *
 * @module teacherIdentity
 */

import { supabase } from '../config/supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Resolved teacher identity — the three IDs every service needs.
 *
 * Once resolved, pass this object through the call chain instead of
 * extracting individual UUIDs from the session.
 */
export interface TeacherIdentity {
  /** `auth.users.id` = `profiles.profile_id`. Use this for the `profiles` table. */
  profileId: string;

  /** `teacher_details.teacher_id`. Use this for `teacher_details` and RLS-bound FKs. */
  teacherId: string;

  /** `profiles.institute_id` (may be null if no institute is assigned). */
  instituteId: string | null;
}

// ─── In-Memory Cache ────────────────────────────────────────────────────────

/**
 * Holds the last-resolved identity so that repeated calls within the same
 * session don't re-query the database. The cache is cleared on sign-out
 * (AuthContext calls `clearTeacherIdentityCache()` on logout).
 */
let cachedIdentity: TeacherIdentity | null = null;

/**
 * Clears the in-memory cache. Call when the user signs out.
 */
export function clearTeacherIdentityCache(): void {
  cachedIdentity = null;
}

// ─── Resolver ───────────────────────────────────────────────────────────────

/**
 * Resolves the authenticated user's teacher identity.
 *
 * This function:
 * 1. Fetches the current Supabase Auth session
 * 2. Extracts `profileId` (= `auth.users.id`)
 * 3. Queries `teacher_details` via the FK (`profile_id`) to get `teacherId`
 * 4. Queries `profiles` to get `instituteId`
 *
 * Results are cached in memory for the session lifetime. Call
 * `clearTeacherIdentityCache()` on sign-out to force a fresh resolution.
 *
 * @returns A `TeacherIdentity` object, or `null` if the user is not
 *          authenticated or has no teacher_details record.
 */
export async function resolveTeacherIdentity(): Promise<TeacherIdentity | null> {
  // Return cached value if available
  if (cachedIdentity) {
    return cachedIdentity;
  }

  // Get the current session
  const { data: sessionData } = await supabase.auth.getSession();
  const profileId = sessionData?.session?.user?.id;

  if (!profileId) {
    return null;
  }

  // Query profiles for institute_id
  const { data: profileRecord } = await supabase
    .from('profiles')
    .select('institute_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  // Query teacher_details for teacher_id
  const { data: teacherRecord } = await supabase
    .from('teacher_details')
    .select('teacher_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (!teacherRecord) {
    return null;
  }

  const identity: TeacherIdentity = {
    profileId,
    teacherId: teacherRecord.teacher_id,
    instituteId: profileRecord?.institute_id ?? null,
  };

  // Cache for subsequent calls
  cachedIdentity = identity;

  return identity;
}

/**
 * Returns the currently cached identity without making a network request.
 *
 * Useful for synchronous lookups after the identity has already been resolved.
 * Returns `null` if the cache is empty (not yet resolved or cleared).
 */
export function getCachedIdentity(): TeacherIdentity | null {
  return cachedIdentity;
}

/**
 * Pre-populates the cache with a known identity.
 *
 * Called by AuthContext after a successful sign-in or session restore so that
 * subsequent calls to `resolveTeacherIdentity()` return immediately from cache.
 */
export function setCachedIdentity(identity: TeacherIdentity): void {
  cachedIdentity = identity;
}
