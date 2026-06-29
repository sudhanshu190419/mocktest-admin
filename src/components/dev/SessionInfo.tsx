'use client';

import { useAuth } from '@/hooks/useAuth';
import StatusBadge from './StatusBadge';

export default function SessionInfo() {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return <div className="text-[11px] text-gray-600">Loading session...</div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="rounded border border-amber-700/50 bg-amber-950/30 px-4 py-2">
        <span className="text-xs text-amber-400">Not authenticated. Sign in to use the Developer Console.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500 px-1">
      <StatusBadge label={user.role} variant="info" />
      <span>User ID: <span className="text-gray-300 font-mono">{user.id}</span></span>
      <span>Email: <span className="text-gray-300">{user.email}</span></span>
      <span>Institute ID: <span className="text-gray-300 font-mono">{user.instituteId ?? '—'}</span></span>
      {!user.instituteId && (
        <span className="text-amber-400 font-semibold">⚠ No Institute assigned</span>
      )}
    </div>
  );
}
