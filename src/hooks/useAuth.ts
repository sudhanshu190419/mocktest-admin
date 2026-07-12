/**
 * useAuth
 *
 * Auth orchestration hook that bridges `authService` API calls to the
 * Redux store, managing loading / error state automatically.
 *
 * ## Responsibilities
 *
 * - Expose `login`, `register`, `logout`, `verifyOtp`, `resendOtp`,
 *   `resetPassword`, and `refreshSession` functions
 * - Read Redux state (`user`, `loading`, `error`, `isAuthenticated`)
 * - Dispatch the appropriate Redux actions after each auth operation
 * - Handle errors uniformly and clear previous errors before new operations
 *
 * ## Boundaries
 *
 * This hook does **not** contain any UI logic — screens consume the exposed
 * state and call the provided functions.
 *
 * @module useAuth
 */

import { useCallback, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  setUser,
  setSession,
  setLoading,
  setError,
  clearError,
  logout as reduxLogout,
} from '../store/authSlice';
import {
  selectUser,
  selectIsAuthenticated,
  selectIsLoading,
  selectAuthError,
} from '../store/authSlice';
import {
  signIn as authSignIn,
  signUp as authSignUp,
  signOut as authSignOut,
  verifyOtp as authVerifyOtp,
  resendOtp as authResendOtp,
  updatePassword as authUpdatePassword,
  refreshSession as authRefreshSession,
  getSession,
} from '../services/authService';
import type { UserProfile } from '../types/auth';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Result returned by `login()`, `register()`, and other auth actions.
 *
 * Consumers check `success` to decide whether to navigate or display
 * feedback — they never need to inspect raw Supabase errors.
 */
export type AuthHookResult =
  | { success: true; warning?: string }
  | { success: false; error: string };

/**
 * Result returned by `register()` — includes the phone number so the
 * OTP verification screen can proceed without the user re-entering it.
 */
export type RegisterHookResult = AuthHookResult & { phone?: string };

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Reusable auth orchestration hook.
 */
export function useAuth() {
  const dispatch = useAppDispatch();

  // ── Reactive state ────────────────────────────────────────────────────

  const user = useAppSelector(selectUser);
  const loading = useAppSelector(selectIsLoading);
  const error = useAppSelector(selectAuthError);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);

  // Guard to prevent concurrent auth operations from racing.
  const pendingRef = useRef(false);

  // ── Actions ──────────────────────────────────────────────────────────

  /**
   * Sign in an existing user with phone + password.
   *
   * On success the Redux store is updated with the full `SessionData` via
   * `setSession` (which also populates `user` and `isAuthenticated`).
   */
  const login = useCallback(
    async (phone: string, password: string): Promise<AuthHookResult> => {
      if (pendingRef.current) {
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
        const result = await authSignIn({ phone, password });

        if (!result.success) {
          dispatch(setError(result.error ?? 'Sign in failed.'));
          return { success: false, error: result.error ?? 'Sign in failed.' };
        }

        // Fetch the full session (includes profile from the `profiles` table)
        const sessionResult = await getSession();

        if (sessionResult.success && sessionResult.data) {
          dispatch(setSession(sessionResult.data));
        } else if (result.data) {
          dispatch(setUser(result.data));
        }

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
        dispatch(setError(message));
        return { success: false, error: message };
      } finally {
        dispatch(setLoading(false));
        pendingRef.current = false;
      }
    },
    [dispatch],
  );

  /**
   * Register a new user account with phone + password.
   *
   * Supabase sends an SMS OTP to the phone. The user must verify it
   * via `verifyOtp()` to complete registration.
   *
   * Returns the phone number in the result so the screen can navigate
   * to the OTP verification screen with it.
   */
  const register = useCallback(
    async (
      phone: string,
      password: string,
      name: string,
    ): Promise<RegisterHookResult> => {
      if (pendingRef.current) {
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
        // Role is NOT sent from the frontend — the database trigger
        // (handle_new_user()) defaults to 'student' when not provided.
        const result = await authSignUp({ phone, password, name });

        if (!result.success) {
          dispatch(setError(result.error ?? 'Registration failed.'));
          return { success: false, error: result.error ?? 'Registration failed.' };
        }

        return { success: true, phone };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
        dispatch(setError(message));
        return { success: false, error: message };
      } finally {
        dispatch(setLoading(false));
        pendingRef.current = false;
      }
    },
    [dispatch],
  );

  /**
   * Verify an SMS OTP.
   *
   * Used in both the registration flow (after signUp) and the forgot
   * password flow (after requesting an OTP).
   *
   * @param phone  - The phone number the OTP was sent to.
   * @param token  - The OTP code.
   * @param options - Optional settings:
   *   - `updateSession` (default `true`): When `false`, the Redux store
   *     is NOT updated with the user's session. This is used in the
   *     forgot-password flow where we only need the OTP verified so the
   *     user can set a new password — updating the session would trigger
   *     automatic navigation to the App stack.
   */
  const verifyOtp = useCallback(
    async (
      phone: string,
      token: string,
      options?: { updateSession?: boolean },
    ): Promise<AuthHookResult> => {
      const updateSession = options?.updateSession ?? true;

      if (pendingRef.current) {
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
        const result = await authVerifyOtp({ phone, token });

        if (!result.success) {
          dispatch(setError(result.error ?? 'OTP verification failed.'));
          return { success: false, error: result.error ?? 'OTP verification failed.' };
        }

        // OTP verified — update the store with the user profile
        // (skipped for forgot-password flow to prevent automatic navigation)
        if (updateSession && result.data) {
          const sessionResult = await getSession();
          if (sessionResult.success && sessionResult.data) {
            dispatch(setSession(sessionResult.data));
          } else {
            dispatch(setUser(result.data));
          }
        }

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
        dispatch(setError(message));
        return { success: false, error: message };
      } finally {
        dispatch(setLoading(false));
        pendingRef.current = false;
      }
    },
    [dispatch],
  );

  /**
   * Resend the SMS OTP to the user's phone.
   */
  const resendOtp = useCallback(
    async (phone: string): Promise<AuthHookResult> => {
      if (pendingRef.current) {
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
        const result = await authResendOtp(phone);

        if (!result.success) {
          dispatch(setError(result.error ?? 'Failed to resend OTP.'));
          return { success: false, error: result.error ?? 'Failed to resend OTP.' };
        }

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
        dispatch(setError(message));
        return { success: false, error: message };
      } finally {
        dispatch(setLoading(false));
        pendingRef.current = false;
      }
    },
    [dispatch],
  );

  /**
   * Reset the user's password (after OTP verification in forgot password flow).
   *
   * On success, signs the user out and clears the session so they must
   * sign in again with their new password.
   */
  const resetPassword = useCallback(
    async (newPassword: string): Promise<AuthHookResult> => {
      if (pendingRef.current) {
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
        const result = await authUpdatePassword(newPassword);

        if (!result.success) {
          dispatch(setError(result.error ?? 'Password update failed.'));
          return { success: false, error: result.error ?? 'Password update failed.' };
        }

        // Password updated — sign out so the user signs in again
        await authSignOut();
        dispatch(reduxLogout());

        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
        dispatch(setError(message));
        return { success: false, error: message };
      } finally {
        dispatch(setLoading(false));
        pendingRef.current = false;
      }
    },
    [dispatch],
  );

  /**
   * Sign out the current user.
   */
  const logout = useCallback(async (): Promise<void> => {
    if (pendingRef.current) return;

    pendingRef.current = true;
    dispatch(setLoading(true));

    try {
      await authSignOut();
    } catch {
      // Even if the network request fails, we clear local state.
    } finally {
      dispatch(reduxLogout());
      dispatch(setLoading(false));
      pendingRef.current = false;
    }
  }, [dispatch]);

  /**
   * Force-refresh the current session tokens.
   */
  const refreshSession = useCallback(async (): Promise<AuthHookResult> => {
    if (pendingRef.current) {
      return { success: false, error: 'An authentication operation is already in progress.' };
    }

    pendingRef.current = true;
    dispatch(setLoading(true));
    dispatch(clearError());

    try {
      const result = await authRefreshSession();

      if (!result.success) {
        dispatch(reduxLogout());
        return { success: false, error: result.error ?? 'Session refresh failed.' };
      }

      if (result.data) {
        dispatch(setSession(result.data));
      }

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      dispatch(reduxLogout());
      dispatch(setError(message));
      return { success: false, error: message };
    } finally {
      dispatch(setLoading(false));
      pendingRef.current = false;
    }
  }, [dispatch]);

  // ── Public API ───────────────────────────────────────────────────────

  return {
    // State
    user,
    loading,
    error,
    isAuthenticated,

    // Actions
    login,
    register,
    verifyOtp,
    resendOtp,
    resetPassword,
    logout,
    refreshSession,
  } as const;
}
