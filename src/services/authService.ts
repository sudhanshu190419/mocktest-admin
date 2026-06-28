/**
 * Auth Service
 *
 * Clean-architecture service layer encapsulating all Supabase Auth operations.
 *
 * Every public method returns a standardised `AuthResponse<T>` shape so that
 * consumers (hooks, screens, etc.) never need to concern themselves with
 * the raw Supabase client or its error format.
 *
 * ## Architecture decisions
 *
 * 1. **Profile is the source of truth for roles.**
 *    The `profiles.role` column in PostgreSQL is authoritative. The auth
 *    user's `raw_user_meta_data.role` is NOT used—the service always
 *    queries `public.profiles` after authentication.
 *
 * 2. **Profile creation is owned by the database.**
 *    The `on_auth_user_created` trigger (→ `handle_new_user()`) is the
 *    sole mechanism for inserting into `public.profiles`. The frontend
 *    **never** writes to the profiles table during sign-up.
 *
 * 3. **Input validation hooks are designed for future Zod migration.**
 *    The `validateSignUpInput` / `validateSignInInput` helpers perform
 *    basic checks now. When Zod is introduced, replace the body with:
 *      `const schema = z.object({ ... });`
 *      `const result = schema.safeParse(input);`
 *      `return result.success ? { valid: true } : { valid: false, error: result.error.message };`
 *
 * @module authService
 */

import { supabase } from '../config/supabase';
import { AuthError, PostgrestError } from '@supabase/supabase-js';
import type {
  AuthResponse,
  DbProfile,
  SessionData,
  SignInInput,
  SignUpInput,
  UserProfile,
  UserRole,
  ValidationResult,
} from '../types/auth';

// ─── Input Validation Hooks ─────────────────────────────────────────────────
// These are designed to be seamlessly replaced by Zod schemas.
// Migration path:
//   import { z } from 'zod';
//   const signUpSchema = z.object({ ... });
//   export function validateSignUpInput(input: SignUpInput): ValidationResult {
//     const result = signUpSchema.safeParse(input);
//     return result.success
//       ? { valid: true }
//       : { valid: false, error: result.error.issues[0]?.message ?? 'Invalid input' };
//   }

/**
 * Validates sign-up input fields.
 *
 * @todo Replace body with Zod schema parsing.
 */
export function validateSignUpInput(input: SignUpInput): ValidationResult {
  if (!input.email?.trim()) {
    return { valid: false, error: 'Email is required.' };
  }

  if (!input.password?.trim()) {
    return { valid: false, error: 'Password is required.' };
  }

  if (input.password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters.' };
  }

  if (!input.name?.trim()) {
    return { valid: false, error: 'Full name is required.' };
  }

  return { valid: true };
}

/**
 * Validates sign-in input fields.
 *
 * @todo Replace body with Zod schema parsing.
 */
export function validateSignInInput(input: SignInInput): ValidationResult {
  if (!input.email?.trim()) {
    return { valid: false, error: 'Email is required.' };
  }

  if (!input.password?.trim()) {
    return { valid: false, error: 'Password is required.' };
  }

  return { valid: true };
}

// ─── Database Helpers ───────────────────────────────────────────────────────

/**
 * Fetches a single profile row from the `profiles` table.
 *
 * Profile creation is handled entirely by the `on_auth_user_created` database
 * trigger. The frontend never inserts into `public.profiles`.
 *
 * @param userId - The `auth.users.id` (matches `profiles.profile_id`).
 * @returns The profile row, or `null` when the row doesn't exist.
 */
async function fetchProfile(userId: string): Promise<DbProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('profile_id', userId)
    .single<DbProfile>();

  if (error) {
    // PGRST116 = "The result contains 0 rows" — this is not a real error
    if (error.code === 'PGRST116') {
      return null;
    }

    // All other database errors are unexpected; rethrow to be caught
    // by the caller's try-catch.
    throw error;
  }

  return data;
}

// ─── Profile Mapping ────────────────────────────────────────────────────────

/**
 * Merges a Supabase `User` with an optional `DbProfile` into a `UserProfile`.
 *
 * The DB profile is the **primary source of truth**. Auth metadata is used
 * only as a fallback when the profile has not yet been created by the
 * database trigger (e.g. immediately after sign-up).
 *
 * The `role` defaults to `'student'`, `instituteId` to `null`, when no
 * profile row exists yet.
 */
function buildUserProfile(
  authUser: {
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
    created_at?: string;
    user_metadata?: {
      full_name?: string;
    };
  },
  profile?: DbProfile | null,
): UserProfile {
  return {
    id: authUser.id,
    email: authUser.email ?? '',
    emailVerified: !!authUser.email_confirmed_at,
    name: profile?.name ?? authUser.user_metadata?.full_name ?? '',
    role: profile?.role ?? 'student',
    instituteId: profile?.institute_id ?? null,
    phone: profile?.phone ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: authUser.created_at ?? new Date().toISOString(),
  };
}

// ─── Error Helpers ──────────────────────────────────────────────────────────

/**
 * Safely extracts a human-readable message from any error value.
 *
 * Normalises `AuthError`, `PostgrestError`, and plain `Error` instances
 * into a single string so that callers never need to inspect error types.
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    return error.message;
  }

  if (error instanceof PostgrestError) {
    // Include the Postgres error code for debugging without leaking details
    // to the UI.  The message alone is sufficient for most consumers.
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected authentication error occurred.';
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Register a new user account.
 *
 * Profile creation is handled entirely by the `on_auth_user_created` database
 * trigger. The frontend never inserts into `public.profiles`.
 *
 * On success, Supabase may send a confirmation email depending on the
 * project's `auth.confirmations.disable_signup_email` setting.
 *
 * @param input - The sign-up credentials and profile data.
 *
 * @returns `AuthResponse<UserProfile>` — the `data.emailVerified` field
 *          indicates whether the email still requires confirmation.
 *
 * @example
 * const result = await signUp({ email: 'a@b.com', password: '...', name: 'Alice' });
 * if (!result.success) {
 *   // display result.error to the user
 * }
 */
export async function signUp(input: SignUpInput): Promise<AuthResponse<UserProfile>> {
  try {
    // 1. Validate input ----------------------------------------------------
    const validation = validateSignUpInput(input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { email, password, name } = input;

    // 2. Create auth user --------------------------------------------------
    // The database trigger (on_auth_user_created → handle_new_user())
    // automatically creates the profile row after this succeeds.
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
        },
      },
    });

    if (authError) {
      return { success: false, error: extractErrorMessage(authError) };
    }

    if (!authData.user) {
      return {
        success: false,
        error:
          'Account created but could not retrieve user details. Please try signing in.',
      };
    }

    // 3. Return result -----------------------------------------------------
    // The profile will be created by the database trigger. No frontend
    // insert into public.profiles is performed here.
    const userProfile = buildUserProfile(authData.user, null);

    return { success: true, data: userProfile };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Authenticate an existing user with email and password.
 *
 * After authentication, the service fetches the user's profile from the
 * `profiles` table to obtain the authoritative role.
 *
 * @param input - The sign-in credentials.
 *
 * @example
 * const result = await signIn({ email: 'a@b.com', password: '...' });
 * if (result.success) {
 *   // navigate to home screen
 * }
 */
export async function signIn(input: SignInInput): Promise<AuthResponse<UserProfile>> {
  try {
    // 1. Validate input ----------------------------------------------------
    const validation = validateSignInInput(input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { email, password } = input;

    // 2. Authenticate ------------------------------------------------------
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError) {
      return { success: false, error: extractErrorMessage(authError) };
    }

    if (!authData.user) {
      return { success: false, error: 'Sign-in succeeded but no user data was returned.' };
    }

    // 3. Fetch profile from DB (source of truth for role) ------------------
    let profile: DbProfile | null = null;

    try {
      profile = await fetchProfile(authData.user.id);
    } catch {
      // DB query failed — fall through with metadata-derived profile.
    }

    const userProfile = buildUserProfile(authData.user, profile);

    return { success: true, data: userProfile };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Sign out the currently authenticated user.
 *
 * Clears the local session and notifies the Supabase server to
 * invalidate the refresh token.
 */
export async function signOut(): Promise<AuthResponse<null>> {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Fetch the currently authenticated user from the server.
 *
 * Unlike `getSession()`, this method performs a network request to verify
 * the JWT is still valid.  Use this for sensitive operations such as
 * checking auth status on app launch or accessing protected resources.
 *
 * @see getSession for a faster, locally-cached alternative.
 */
export async function getCurrentUser(): Promise<AuthResponse<UserProfile>> {
  try {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    if (!data.user) {
      return { success: false, error: 'No authenticated user found.' };
    }

    // Fetch profile from DB to get the authoritative role
    let profile: DbProfile | null = null;

    try {
      profile = await fetchProfile(data.user.id);
    } catch {
      // DB query failed — fall through with metadata-derived profile.
    }

    const userProfile = buildUserProfile(data.user, profile);

    return { success: true, data: userProfile };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Retrieve the current session from the local cache.
 *
 * This is a fast, synchronous-like read that does **not** verify the
 * JWT with the server.  Use it for UI decisions (e.g. "show a loading
 * spinner while we refresh the token") rather than security-critical
 * gates.
 *
 * @see getCurrentUser if you need server-verified auth status.
 */
export async function getSession(): Promise<AuthResponse<SessionData>> {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const session = data.session;

    if (!session) {
      return {
        success: true,
        data: {
          isAuthenticated: false,
          accessToken: null,
          refreshToken: null,
          user: null,
        },
      };
    }

    // Fetch profile from DB to get the authoritative role
    let profile: DbProfile | null = null;

    try {
      profile = await fetchProfile(session.user.id);
    } catch {
      // DB query failed — fall through with metadata-derived profile.
    }

    const userProfile = buildUserProfile(session.user, profile);

    return {
      success: true,
      data: {
        isAuthenticated: true,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        user: userProfile,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

/**
 * Force-refresh the current session tokens.
 *
 * Use this when you receive a 401 response from a Supabase query and
 * want to attempt a seamless token refresh before redirecting the user
 * to the login screen.
 */
export async function refreshSession(): Promise<AuthResponse<SessionData>> {
  try {
    const { data, error } = await supabase.auth.refreshSession();

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    const session = data.session;

    if (!session) {
      return {
        success: false,
        error: 'Session refresh failed. Please sign in again.',
      };
    }

    // Fetch profile from DB to get the authoritative role
    let profile: DbProfile | null = null;

    try {
      profile = await fetchProfile(session.user.id);
    } catch {
      // DB query failed — fall through with metadata-derived profile.
    }

    const userProfile = buildUserProfile(session.user, profile);

    return {
      success: true,
      data: {
        isAuthenticated: true,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        user: userProfile,
      },
    };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}
