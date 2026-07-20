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

// ---- Types -----------------------------------------------------------------

export type AuthHookResult =
  | { success: true; warning?: string }
  | { success: false; error: string };

export type RegisterHookResult = AuthHookResult & { phone?: string };

// ---- Hook -----------------------------------------------------------------

export function useAuth() {
  const dispatch = useAppDispatch();

  const user = useAppSelector(selectUser);
  const loading = useAppSelector(selectIsLoading);
  const error = useAppSelector(selectAuthError);
  const isAuthenticated = useAppSelector(selectIsAuthenticated);

  const pendingRef = useRef(false);

  const login = useCallback(
    async (phone: string, password: string): Promise<AuthHookResult> => {
      console.log('[LiveKit Debug] useAuth.login — START (phone obfuscated):', phone.slice(0, 5) + '****');

      if (pendingRef.current) {
        console.warn('[LiveKit Debug] useAuth.login — ABORTED: operation already in progress');
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
        console.log('[LiveKit Debug] useAuth.login — calling authSignIn...');
        const result = await authSignIn({ phone, password });

        if (!result.success) {
          console.error('[LiveKit Debug] useAuth.login — authSignIn FAILED:', result.error);
          dispatch(setError(result.error ?? 'Sign in failed.'));
          return { success: false, error: result.error ?? 'Sign in failed.' };
        }

        console.log('[LiveKit Debug] useAuth.login — authSignIn succeeded, fetching session...');

        const sessionResult = await getSession();

        if (sessionResult.success && sessionResult.data) {
          console.log('[LiveKit Debug] useAuth.login — dispatching setSession');
          dispatch(setSession(sessionResult.data));
        } else if (result.data) {
          console.warn('[LiveKit Debug] useAuth.login — session fetch failed, falling back to setUser');
          dispatch(setUser(result.data));
        }

        console.log('[LiveKit Debug] useAuth.login — COMPLETE');
        return { success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
        console.error('[LiveKit Debug] useAuth.login — UNEXPECTED ERROR:', message);
        dispatch(setError(message));
        return { success: false, error: message };
      } finally {
        dispatch(setLoading(false));
        pendingRef.current = false;
      }
    },
    [dispatch],
  );

  const register = useCallback(
    async (phone: string, password: string, name: string): Promise<RegisterHookResult> => {
      if (pendingRef.current) {
        return { success: false, error: 'An authentication operation is already in progress.' };
      }

      pendingRef.current = true;
      dispatch(setLoading(true));
      dispatch(clearError());

      try {
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

  const verifyOtp = useCallback(
    async (phone: string, token: string, options?: { updateSession?: boolean }): Promise<AuthHookResult> => {
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
          return { success: false, error: 'Failed to resend OTP.' };
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
          return { success: false, error: 'Password update failed.' };
        }

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

  const logout = useCallback(async (): Promise<void> => {
    console.log('[LiveKit Debug] useAuth.logout — START');

    if (pendingRef.current) {
      console.warn('[LiveKit Debug] useAuth.logout — operation already in progress, returning');
      return;
    }

    pendingRef.current = true;
    dispatch(setLoading(true));

    try {
      console.log('[LiveKit Debug] useAuth.logout — calling authSignOut...');
      await authSignOut();
      console.log('[LiveKit Debug] useAuth.logout — authSignOut succeeded');
    } catch (err) {
      console.warn('[LiveKit Debug] useAuth.logout — authSignOut failed (clearing local state anyway):', err);
    } finally {
      dispatch(reduxLogout());
      dispatch(setLoading(false));
      pendingRef.current = false;
      console.log('[LiveKit Debug] useAuth.logout — COMPLETE');
    }
  }, [dispatch]);

  const refreshSession = useCallback(async (): Promise<AuthHookResult> => {
    console.log('[LiveKit Debug] useAuth.refreshSession — START');

    if (pendingRef.current) {
      console.warn('[LiveKit Debug] useAuth.refreshSession — ABORTED: operation already in progress');
      return { success: false, error: 'An authentication operation is already in progress.' };
    }

    pendingRef.current = true;
    dispatch(setLoading(true));
    dispatch(clearError());

    try {
      console.log('[LiveKit Debug] useAuth.refreshSession — calling authRefreshSession...');
      const result = await authRefreshSession();

      if (!result.success) {
        console.error('[LiveKit Debug] useAuth.refreshSession — FAILED:', result.error);
        dispatch(reduxLogout());
        return { success: false, error: result.error ?? 'Session refresh failed.' };
      }

      if (result.data) {
        console.log('[LiveKit Debug] useAuth.refreshSession — dispatching setSession');
        dispatch(setSession(result.data));
      }

      console.log('[LiveKit Debug] useAuth.refreshSession — COMPLETE');
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      console.error('[LiveKit Debug] useAuth.refreshSession — UNEXPECTED ERROR:', message);
      dispatch(reduxLogout());
      dispatch(setError(message));
      return { success: false, error: message };
    } finally {
      dispatch(setLoading(false));
      pendingRef.current = false;
    }
  }, [dispatch]);

  return {
    user,
    loading,
    error,
    isAuthenticated,
    login,
    register,
    verifyOtp,
    resendOtp,
    resetPassword,
    logout,
    refreshSession,
  } as const;
}
