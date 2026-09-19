'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await signOut();
      router.push('/');
      router.refresh();
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={loading}
      className={
        className ??
        'rounded-pill px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-page-tint hover:text-ink disabled:opacity-50'
      }
    >
      {loading ? 'Signing out…' : 'Log out'}
    </button>
  );
}
