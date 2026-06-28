/**
 * useAuth
 *
 * Auth orchestration hook that bridges `authService` API calls to the
 * Redux store, managing loading / error state automatically.
 *
 * ## Responsibilities
 *
 * - Expose `login`, `register`, `logout`, and `refreshSession` functions
 * - Read Redux state (`user`, `loading`, `error`, `isAuthenticated`)
 * - Dispatch the appropriate Redux actions after each auth operation
 * - Handle errors uniformly and clear previous errors before new operations
 *
 * ## Boundaries
 *
 * This hook does **not** contain any UI logic — screens consume the exposed
 * state and call the provided functions.
 *
 * ## Usage
 *
 * ```tsx
 * function LoginForm() {
 *   const { login, user, loading, error } = useAuth();
 *
 *   const handleLogin = async () => {
 *     const result = await login(email, password);
 *     if (result.success) {
 *       // Navigation is handled automatically by AuthNavigator
 *       // based on Redux state changes.
 *     }
 *   };
 * }
 * ```
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
  refreshSession as authRefreshSession,
  getSession,
} from '../services/authService';
import type { UserProfile } from '../types/auth';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Result returned by `login()` and `register()`.
 *
 * Consumers check `success` to decide whether to navigate or display
 * feedback — they never need to inspect raw Supabase errors.
 */
export type AuthHookResult =
  | { success: true; warning?: string }
  | { success: false; error: string };

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Reusable auth orchestration hook.
 *
 * Provides four actions (`login`, `register`, `logout`, `refreshSession`)
 * and four pieces of reactive state (`user`, `loading`, `error`,
 * `isAuthenticated`) — everything a screen needs for auth flows.
 */
export function useAuth() {
  const dispatch = useAppDispatch();

  // ── Reactive state ───────────────────────────────────────────────────-

  const user = useAppSelector(selectUser);
  const loading = useAppSelector(selectIsLoading);
  const error = useAppSelector(selectAuthError);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);

  // Guard to prevent concurrent auth operations from racing.
  // Using a ref (not state) avoids unnecessary re-renders and is
  // consistent with the Redux `loading` flag.
  const pendingRef = useRef(false);

  // ── Actions ──────────────────────────────────────────────────────────-

  /**
   * Sign in an existing user.
   *
   * On success the Redux store is updated with the full `SessionData` via
   * `setSession` (which also populates `user` and `isAuthenticated`).
   * `AuthNavigator` reacts to the state change and navigates to the App
   * Stack automatically.
   *
   * @param email    - The user's email address.
   * @param password - The user's password.
   */
  const login = useCallback(
    async (email: string, password: string): Promise<AuthHookResult> => {
      if (pendingRef.current) {
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
        const result = await authSignIn({ email, password });

        if (!result.success) {
          dispatch(setError(result.error ?? 'Sign in failed.'));
          return { success: false, error: result.error ?? 'Sign in failed.' };
        }

        // Sign-in succeeded — fetch the full session (includes profile
        // from the `profiles` table with the authoritative role).
        const sessionResult = await getSession();

        if (sessionResult.success && sessionResult.data) {
          dispatch(setSession(sessionResult.data));
        } else if (result.data) {
          // Fallback: session fetch failed but we have the user profile.
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
   * Register a new user account.
   *
   * If email confirmation is enabled in the Supabase project settings,
   * the user will **not** receive a session immediately — the hook
   * returns `success: true` and the screen can display a confirmation
   * message.  The `user` is still populated from the sign-up response so
   * the UI can show the user's name.
   *
   * @param email    - The new user's email address.
   * @param password - The new user's password (minimum 6 characters).
   * @param name - The user's display / full name.
   */
  const register = useCallback(
    async (
      email: string,
      password: string,
      name: string,
    ): Promise<AuthHookResult> => {
      if (pendingRef.current) {
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
        const result = await authSignUp({ email, password, name });

        if (!result.success) {
          dispatch(setError(result.error ?? 'Registration failed.'));
          return { success: false, error: result.error ?? 'Registration failed.' };
        }

        // Populate the user immediately so the UI can react.
        // The session will be established once the user confirms their
        // email (if confirmation is enabled) or through AuthProvider.
        if (result.data) {
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
   * Sign out the current user.
   *
   * Calls `authService.signOut()` and then dispatches the Redux `logout`
   * action, which resets `user`, `session`, `isAuthenticated`, and
   * `error` back to defaults while preserving `initialized = true` so
   * the navigation tree reacts immediately.
   */
  const logout = useCallback(async (): Promise<void> => {
    if (pendingRef.current) return;

    pendingRef.current = true;
    dispatch(setLoading(true));

    try {
      await authSignOut();
    } catch {
      // Even if the network request fails, we clear local state so the
      // user is not stranded.  The Supabase session will be invalidated
      // on the server side eventually.
    } finally {
      dispatch(reduxLogout());
      dispatch(setLoading(false));
      pendingRef.current = false;
    }
  }, [dispatch]);

  /**
   * Force-refresh the current session tokens.
   *
   * Useful after a 401 response — call this and, if it succeeds, retry
   * the failed request.  The Redux store is updated with the new
   * `SessionData` automatically.
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
        // Session refresh failed — the user must sign in again.
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

  // ── Public API ───────────────────────────────────────────────────────-

  return {
    // State
    user,
    loading,
    error,
    isAuthenticated,

    // Actions
    login,
    register,
    logout,
    refreshSession,
  } as const;
}
