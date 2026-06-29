'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getSession, getCurrentUser } from '@/services/authService';
import { supabase } from '@/config/supabase';
import SectionCard from '@/components/dev/SectionCard';
import DebugPanel from '@/components/dev/DebugPanel';
import StatusBadge from '@/components/dev/StatusBadge';
import ApiResponseCard from '@/components/dev/ApiResponseCard';
import LoadingIndicator from '@/components/dev/LoadingIndicator';
import type { AuthResponse, SessionData, UserProfile } from '@/types/auth';

type LastAction = {
  name: string;
  success: boolean | null;
  data?: unknown;
  error?: string | null;
};

function SessionValue({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline gap-2 py-1 border-b border-gray-800 last:border-0">
      <span className="text-[11px] text-gray-500 w-28 shrink-0">{label}</span>
      <span className="text-xs text-gray-200 font-mono break-all">{value ?? '—'}</span>
    </div>
  );
}

export default function AuthenticationPage() {
  const { login, register, logout, refreshSession, user, loading, error, isAuthenticated } = useAuth();

  // ── Form state ─────────────────────────────────────────────────────
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regName, setRegName] = useState('');
  const [regRole, setRegRole] = useState<'student' | 'teacher' | 'admin'>('student');
  const [regInstitute, setRegInstitute] = useState('');

  const [resetEmail, setResetEmail] = useState('');

  // ── Response / status state ────────────────────────────────────────
  const [sessionData, setSessionData] = useState<AuthResponse<SessionData> | null>(null);
  const [currentUserResult, setCurrentUserResult] = useState<AuthResponse<UserProfile> | null>(null);
  const [forgotResult, setForgotResult] = useState<{ success: boolean; data?: unknown; error?: string } | null>(null);
  const [debugLastAction, setDebugLastAction] = useState<LastAction | null>(null);

  // ── Handlers ───────────────────────────────────────────────────────
  const handleLogin = useCallback(async () => {
    setDebugLastAction({ name: 'login', success: null });
    const result = await login(loginEmail, loginPassword);
    setDebugLastAction({ name: 'login', success: result.success, data: result, error: !result.success ? result.error : null });
  }, [login, loginEmail, loginPassword]);

  const handleRegister = useCallback(async () => {
    setDebugLastAction({ name: 'register', success: null });
    const result = await register(regEmail, regPassword, regName);
    setDebugLastAction({ name: 'register', success: result.success, data: result, error: !result.success ? result.error : null });
  }, [register, regEmail, regPassword, regName]);

  const handleLogout = useCallback(async () => {
    setDebugLastAction({ name: 'logout', success: null });
    await logout();
    setDebugLastAction({ name: 'logout', success: true });
  }, [logout]);

  const handleRefreshSession = useCallback(async () => {
    setDebugLastAction({ name: 'refreshSession', success: null });
    const result = await refreshSession();
    setDebugLastAction({ name: 'refreshSession', success: result.success, data: result, error: !result.success ? result.error : null });
  }, [refreshSession]);

  const handleGetSession = useCallback(async () => {
    setDebugLastAction({ name: 'getSession', success: null });
    const result = await getSession();
    setSessionData(result);
    setDebugLastAction({ name: 'getSession', success: result.success, data: result, error: result.error });
  }, []);

  const handleGetCurrentUser = useCallback(async () => {
    setDebugLastAction({ name: 'getCurrentUser', success: null });
    const result = await getCurrentUser();
    setCurrentUserResult(result);
    setDebugLastAction({ name: 'getCurrentUser', success: result.success, data: result, error: result.error });
  }, []);

  const handleForgotPassword = useCallback(async () => {
    setDebugLastAction({ name: 'forgotPassword', success: null });
    try {
      const { data, error: supabaseError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      const result = { success: !supabaseError, data, error: supabaseError?.message };
      setForgotResult(result);
      setDebugLastAction({ name: 'forgotPassword', success: result.success, data: result, error: result.error });
    } catch (err) {
      const result = { success: false, data: null, error: err instanceof Error ? err.message : 'Unknown error' };
      setForgotResult(result);
      setDebugLastAction({ name: 'forgotPassword', success: false, error: result.error });
    }
  }, [resetEmail]);

  // ── Derived ────────────────────────────────────────────────────────
  const isActive = isAuthenticated;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Authentication</h1>
          <p className="text-xs text-gray-500 mt-1">Sign up, sign in, session management, role-based access</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge label={isActive ? 'Authenticated' : 'Unauthenticated'} variant={isActive ? 'success' : 'warning'} />
          {loading && <LoadingIndicator label="Processing..." />}
        </div>
      </div>

      {/* Current User Snapshot */}
      {user && (
        <SectionCard title="Current User" description="Authenticated user profile from Redux state">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <SessionValue label="User ID" value={user.id} />
            <SessionValue label="Email" value={user.email} />
            <SessionValue label="Name" value={user.name} />
            <SessionValue label="Role" value={user.role} />
            <SessionValue label="Institute ID" value={user.instituteId} />
            <SessionValue label="Email Verified" value={user.emailVerified ? 'Yes' : 'No'} />
            <SessionValue label="Phone" value={user.phone} />
            <SessionValue label="Created At" value={user.createdAt} />
          </div>
        </SectionCard>
      )}

      {error && (
        <div className="rounded border border-red-700/50 bg-red-950/30 px-4 py-3">
          <span className="text-xs font-medium text-red-400">Redux Auth Error: </span>
          <span className="text-xs text-red-300">{error}</span>
        </div>
      )}

      {/* ── Login ───────────────────────────────────────────────────── */}
      <SectionCard title="Login" description="Authenticate with email and password">
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-600"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Password</label>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-600"
            />
          </div>
          <button
            type="button"
            disabled={loading || !loginEmail || !loginPassword}
            onClick={handleLogin}
            className="rounded bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </div>
      </SectionCard>

      {/* ── Register ────────────────────────────────────────────────── */}
      <SectionCard title="Register" description="Create a new user account">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Full Name</label>
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="John Doe"
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-600"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-600"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-600"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Role</label>
              <select
                value={regRole}
                onChange={(e) => setRegRole(e.target.value as typeof regRole)}
                className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-amber-600"
              >
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Institute ID</label>
            <input
              type="text"
              value={regInstitute}
              onChange={(e) => setRegInstitute(e.target.value)}
              placeholder="Optional — assigned by DB trigger"
              className="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-600"
            />
          </div>
          <div className="text-[10px] text-gray-600 italic">
            Profile is created by the database trigger. Role and institute fields shown for reference.
          </div>
          <button
            type="button"
            disabled={loading || !regEmail || !regPassword || !regName}
            onClick={handleRegister}
            className="rounded bg-green-800 px-4 py-2 text-xs font-medium text-green-100 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Registering...' : 'Register'}
          </button>
        </div>
      </SectionCard>

      {/* ── Session ─────────────────────────────────────────────────── */}
      <SectionCard title="Session" description="Inspect current session state">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <SessionValue label="Authenticated?" value={isAuthenticated ? 'Yes' : 'No'} />
            <SessionValue label="User ID" value={user?.id} />
            <SessionValue label="Role" value={user?.role} />
            <SessionValue label="Institute ID" value={user?.instituteId} />
            <SessionValue label="Name" value={user?.name} />
            <SessionValue label="Email" value={user?.email} />
            {user && <SessionValue label="Created" value={user.createdAt} />}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              disabled={loading}
              onClick={handleGetSession}
              className="rounded bg-gray-800 px-3 py-1.5 text-[11px] font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Get Session
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleGetCurrentUser}
              className="rounded bg-gray-800 px-3 py-1.5 text-[11px] font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Get Current User
            </button>
          </div>

          {sessionData && (
            <ApiResponseCard title="Session Response" success={sessionData.success} data={sessionData.data} error={sessionData.error} />
          )}

          {currentUserResult && (
            <ApiResponseCard title="Current User Response" success={currentUserResult.success} data={currentUserResult.data} error={currentUserResult.error} />
          )}
        </div>
      </SectionCard>

      {/* ── Refresh Session ─────────────────────────────────────────── */}
      <SectionCard title="Refresh Session" description="Manually force a token refresh">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Calls <code className="text-amber-400">auth.refreshSession()</code> to rotate the access and refresh tokens.
            Useful after receiving a 401 to attempt seamless recovery.
          </p>
          <button
            type="button"
            disabled={loading || !isAuthenticated}
            onClick={handleRefreshSession}
            className="rounded bg-amber-800 px-4 py-2 text-xs font-medium text-amber-100 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Refreshing...' : 'Refresh Session'}
          </button>
          {!isAuthenticated && (
            <p className="text-[10px] text-gray-600">Sign in first to enable session refresh.</p>
          )}
        </div>
      </SectionCard>

      {/* ── Logout ──────────────────────────────────────────────────── */}
      <SectionCard title="Logout" description="End the current session and clear local state">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Calls <code className="text-amber-400">auth.signOut()</code> and dispatches the Redux <code className="text-amber-400">logout</code> action.
            State is cleared even if the network request fails.
          </p>
          <button
            type="button"
            disabled={loading || !isAuthenticated}
            onClick={handleLogout}
            className="rounded bg-red-800 px-4 py-2 text-xs font-medium text-red-100 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing out...' : 'Sign Out'}
          </button>
          {!isAuthenticated && (
            <p className="text-[10px] text-gray-600">Already signed out.</p>
          )}
        </div>
      </SectionCard>

      {/* ── Forgot Password ─────────────────────────────────────────── */}
      <SectionCard title="Forgot Password" description="Request a password reset email">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Sends a password reset email via Supabase. Uses a direct Supabase call — no existing hook wraps this operation.
          </p>
          <div className="space-y-2">
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full max-w-sm rounded border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-amber-600"
            />
          </div>
          <button
            type="button"
            disabled={!resetEmail}
            onClick={handleForgotPassword}
            className="rounded bg-gray-800 px-4 py-2 text-xs font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send Reset Email
          </button>
          {forgotResult && (
            <ApiResponseCard
              title="Password Reset Response"
              success={forgotResult.success}
              data={forgotResult.data}
              error={forgotResult.error}
            />
          )}
        </div>
      </SectionCard>

      {/* ── Debug Panel ─────────────────────────────────────────────── */}
      <DebugPanel
        lastOperation={debugLastAction?.name ?? '—'}
        lastResponse={debugLastAction ?? null}
        info={[
          { label: 'Is Authenticated', value: String(isAuthenticated) },
          { label: 'Loading', value: String(loading) },
          { label: 'Redux Error', value: error },
          { label: 'User ID', value: user?.id ?? 'null' },
          { label: 'User Role', value: user?.role ?? 'null' },
          { label: 'Institute ID', value: user?.instituteId ?? 'null' },
          { label: 'Debug Action', value: debugLastAction?.name ?? '—' },
          { label: 'Action Success', value: debugLastAction ? String(debugLastAction.success) : '—' },
        ]}
      />
    </div>
  );
}
