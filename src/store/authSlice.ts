/**
 * Auth Slice
 *
 * Redux Toolkit slice managing authentication state — user profile,
 * loading/error flags, and session data.
 *
 * This slice is consumed by the `useAuth` hook and is designed to
 * support the session-first auth flow established in authService.ts.
 *
 * @module store/authSlice
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { UserProfile, SessionData } from '../types/auth';

// ─── State Shape ─────────────────────────────────────────────────────────────

export interface AuthState {
  /** Whether the auth system has finished its initialisation check. */
  initialized: boolean;
  /** Whether an auth operation is currently in progress. */
  loading: boolean;
  /** The current authenticated user, or null. */
  user: UserProfile | null;
  /** Whether a valid session exists. */
  isAuthenticated: boolean;
  /** The most recent error message, or null. */
  error: string | null;
  /** Optional full session data (tokens, etc.). */
  session: SessionData | null;
}

const initialState: AuthState = {
  initialized: false,
  loading: false,
  user: null,
  isAuthenticated: false,
  error: null,
  session: null,
};

// ─── Slice ───────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<UserProfile | null>) {
      state.user = action.payload;
      state.isAuthenticated = action.payload !== null;
    },
    setSession(state, action: PayloadAction<SessionData | null>) {
      state.session = action.payload;
      if (action.payload) {
        state.isAuthenticated = action.payload.isAuthenticated;
        state.user = action.payload.user;
      }
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    clearError(state) {
      state.error = null;
    },
    setInitialized(state) {
      state.initialized = true;
    },
    /**
     * Logout — resets all auth state except `initialized`.
     *
     * `initialized` stays `true` so the navigation tree can immediately
     * react and show the login screen without a loading flash.
     */
    logout(state) {
      state.user = null;
      state.isAuthenticated = false;
      state.loading = false;
      state.error = null;
      state.session = null;
    },
  },
});

// ─── Actions ─────────────────────────────────────────────────────────────────

export const {
  setUser,
  setSession,
  setLoading,
  setError,
  clearError,
  setInitialized,
  logout,
} = authSlice.actions;

// ─── Selectors ───────────────────────────────────────────────────────────────

export const selectUser = (state: { auth: AuthState }): UserProfile | null =>
  state.auth.user;

export const selectIsAuthenticated = (state: { auth: AuthState }): boolean =>
  state.auth.isAuthenticated;

export const selectIsLoading = (state: { auth: AuthState }): boolean =>
  state.auth.loading;

export const selectAuthError = (state: { auth: AuthState }): string | null =>
  state.auth.error;

export const selectInitialized = (state: { auth: AuthState }): boolean =>
  state.auth.initialized;

export const selectSession = (state: {
  auth: AuthState;
}): SessionData | null => state.auth.session;

// ─── Reducer ─────────────────────────────────────────────────────────────────

export default authSlice.reducer;
