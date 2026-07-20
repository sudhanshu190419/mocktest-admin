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
 *    The `on_auth_user_created` trigger (-> `handle_new_user()`) is the
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
import { getTokenExpirySummary } from '../utils/supabase';
import type {
  AuthResponse,
  DbProfile,
  SessionData,
  SignInInput,
  SignUpInput,
  UserProfile,
  UserRole,
  ValidationResult,
  VerifyOtpInput,
} from '../types/auth';

// ---- Input Validation Hooks -------------------------------------------------

export function validateSignUpInput(input: SignUpInput): ValidationResult {
  if (!input.phone?.trim()) {
    return { valid: false, error: 'Mobile number is required.' };
  }

  const phoneRegex = /^\+[1-9]\d{6,14}$/;
  if (!phoneRegex.test(input.phone.trim())) {
    return {
      valid: false,
      error: 'Please enter a valid mobile number with country code (e.g. +919876543210).',
    };
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

export function validateSignInInput(input: SignInInput): ValidationResult {
  if (!input.phone?.trim()) {
    return { valid: false, error: 'Mobile number is required.' };
  }

  if (!input.password?.trim()) {
    return { valid: false, error: 'Password is required.' };
  }

  return { valid: true };
}

export function validateOtpInput(input: VerifyOtpInput): ValidationResult {
  if (!input.phone?.trim()) {
    return { valid: false, error: 'Phone number is required.' };
  }

  if (!input.token?.trim()) {
    return { valid: false, error: 'OTP is required.' };
  }

  if (input.token.length < 4 || input.token.length > 8) {
    return { valid: false, error: 'Please enter a valid OTP.' };
  }

  return { valid: true };
}

// ---- Database Helpers -------------------------------------------------------

async function fetchProfile(userId: string): Promise<DbProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('profile_id', userId)
    .single<DbProfile>();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }

  return data;
}

// ---- Profile Mapping --------------------------------------------------------

function buildUserProfile(
  authUser: {
    id: string;
    email?: string | null;
    phone?: string | null;
    email_confirmed_at?: string | null;
    phone_confirmed_at?: string | null;
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
    phoneVerified: !!authUser.phone_confirmed_at,
    name: profile?.name ?? authUser.user_metadata?.full_name ?? '',
    role: profile?.role ?? 'student',
    accountStatus: profile?.account_status ?? 'approved',
    instituteId: profile?.institute_id ?? null,
    phone: profile?.phone ?? authUser.phone ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    createdAt: authUser.created_at ?? new Date().toISOString(),
  };
}

// ---- Error Helpers ----------------------------------------------------------

function extractErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    return error.message;
  }

  if (error instanceof PostgrestError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected authentication error occurred.';
}

// ---- Public API -------------------------------------------------------------

export async function signUp(
  input: SignUpInput,
): Promise<AuthResponse<{ phone: string; password: string }>> {
  try {
    const validation = validateSignUpInput(input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { phone, password, name } = input;

    const { data: authData, error: authError } = await supabase.auth.signUp({
      phone,
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

    return { success: true, data: { phone, password } };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function verifyOtp(input: VerifyOtpInput): Promise<AuthResponse<UserProfile>> {
  try {
    const validation = validateOtpInput(input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { phone, token } = input;

    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    if (!data.user) {
      return {
        success: false,
        error: 'Verification succeeded but no user data was returned.',
      };
    }

    let profile: DbProfile | null = null;
    try {
      profile = await fetchProfile(data.user.id);
    } catch {
      // DB query failed -- fall through with metadata-derived profile.
    }

    const userProfile = buildUserProfile(data.user, profile);

    return { success: true, data: userProfile };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function resendOtp(phone: string): Promise<AuthResponse<null>> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      phone,
      options: {
        shouldCreateUser: false,
      },
    });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function signIn(input: SignInInput): Promise<AuthResponse<UserProfile>> {
  try {
    const validation = validateSignInInput(input);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const { phone, password } = input;

    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        phone,
        password,
      });

    if (authError) {
      return { success: false, error: extractErrorMessage(authError) };
    }

    if (!authData.user) {
      return { success: false, error: 'Sign-in succeeded but no user data was returned.' };
    }

    let profile: DbProfile | null = null;

    try {
      profile = await fetchProfile(authData.user.id);
    } catch {
      // DB query failed -- fall through with metadata-derived profile.
    }

    const userProfile = buildUserProfile(authData.user, profile);

    return { success: true, data: userProfile };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function updatePassword(newPassword: string): Promise<AuthResponse<null>> {
  try {
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters.' };
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return { success: false, error: extractErrorMessage(error) };
    }

    return { success: true, data: null };
  } catch (err) {
    return { success: false, error: extractErrorMessage(err) };
  }
}

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

export async function getCurrentUser(): Promise<AuthResponse<UserProfile>> {
  console.log('[LiveKit Debug] getCurrentUser — fetching authenticated user from server...');
  try {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      console.error('[LiveKit Debug] getCurrentUser — getUser() failed:', {
        errorName: error.name,
        errorMessage: error.message,
        errorStatus: (error as any)?.status,
      });
      return { success: false, error: extractErrorMessage(error) };
    }

    if (!data.user) {
      console.warn('[LiveKit Debug] getCurrentUser — getUser() returned no user.');
      return { success: false, error: 'No authenticated user found.' };
    }

    console.log('[LiveKit Debug] getCurrentUser — user found:', {
      userId: data.user.id,
      email: data.user.email,
      phone: data.user.phone,
    });

    let profile: DbProfile | null = null;

    try {
      profile = await fetchProfile(data.user.id);
    } catch {
      // DB query failed -- fall through with metadata-derived profile.
    }

    const userProfile = buildUserProfile(data.user, profile);

    return { success: true, data: userProfile };
  } catch (err) {
    console.error('[LiveKit Debug] getCurrentUser — unexpected error:', err);
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function getSession(): Promise<AuthResponse<SessionData>> {
  console.log('[LiveKit Debug] getSession — retrieving session from local cache...');
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error('[LiveKit Debug] getSession — getSession() failed:', {
        errorName: error.name,
        errorMessage: error.message,
      });
      return { success: false, error: extractErrorMessage(error) };
    }

    const session = data.session;

    if (!session) {
      console.warn('[LiveKit Debug] getSession — no active session found.');
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

    console.log('[LiveKit Debug] getSession — active session found:', {
      userId: session.user.id,
      email: session.user.email,
      phone: session.user.phone,
      hasAccessToken: !!session.access_token,
      accessTokenExpiry: getTokenExpirySummary(session.access_token),
      hasRefreshToken: !!session.refresh_token,
      createdAt: session.user.created_at,
    });

    let profile: DbProfile | null = null;

    try {
      profile = await fetchProfile(session.user.id);
    } catch {
      // DB query failed -- fall through with metadata-derived profile.
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
    console.error('[LiveKit Debug] getSession — unexpected error:', err);
    return { success: false, error: extractErrorMessage(err) };
  }
}

export async function refreshSession(): Promise<AuthResponse<SessionData>> {
  console.log('[LiveKit Debug] refreshSession — BEFORE calling supabase.auth.refreshSession()');

  const beforeSession = await supabase.auth.getSession();
  if (beforeSession.data?.session?.access_token) {
    console.log('[LiveKit Debug] refreshSession — session BEFORE refresh:', {
      userId: beforeSession.data.session.user.id,
      tokenExpiry: getTokenExpirySummary(beforeSession.data.session.access_token),
    });
  } else {
    console.warn('[LiveKit Debug] refreshSession — no session to refresh.');
  }

  try {
    const { data, error } = await supabase.auth.refreshSession();

    if (error) {
      console.error('[LiveKit Debug] refreshSession — refreshSession() FAILED:', {
        errorName: error.name,
        errorMessage: error.message,
        errorStatus: (error as any)?.status,
      });
      return { success: false, error: extractErrorMessage(error) };
    }

    const session = data.session;

    if (!session) {
      console.error('[LiveKit Debug] refreshSession — refresh succeeded but returned no session.');
      return {
        success: false,
        error: 'Session refresh failed. Please sign in again.',
      };
    }

    console.log('[LiveKit Debug] refreshSession — refresh SUCCEEDED:', {
      userId: session.user.id,
      newTokenExpiry: getTokenExpirySummary(session.access_token),
      hasRefreshToken: !!session.refresh_token,
    });

    let profile: DbProfile | null = null;

    try {
      profile = await fetchProfile(session.user.id);
    } catch {
      // DB query failed -- fall through with metadata-derived profile.
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
    console.error('[LiveKit Debug] refreshSession — unexpected error:', err);
    return { success: false, error: extractErrorMessage(err) };
  }
}
